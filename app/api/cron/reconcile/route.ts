import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStatus } from "@/lib/imaging"
import { completeStep, handleGenerationError, kickQueued, type FileGroupRow } from "@/lib/orchestrator"
import { renderReel } from "@/lib/reel"

export const maxDuration = 300

// Every-minute safety net: poll fal for steps stuck in running >3 min
// (missed/failed webhooks) and complete or fail them. Also the primary
// completion path in local dev, where fal can't reach a webhook (?all=1
// reconciles regardless of age).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const all = new URL(req.url).searchParams.get("all") === "1"
  const cutoff = new Date(Date.now() - 3 * 60_000).toISOString()

  const db = createAdminClient()
  let query = db.from("file_groups").select("*").eq("step_status", "running")
  if (!all) query = query.lt("step_started_at", cutoff)
  const { data: stuck } = await query.returns<FileGroupRow[]>()

  const results: Record<string, string> = {}
  for (const fg of stuck ?? []) {
    try {
      if (!fg.fal_request_id) {
        // crashed between claim and submit — no request to poll
        await handleGenerationError(db, { ...fg, retry_count: 1 }, "submission never completed")
        results[fg.id] = "failed:no-request-id"
        continue
      }
      const status = await getStatus(fg.provider, fg.fal_request_id)
      if (status === "COMPLETED") {
        await completeStep(db, fg)
        results[fg.id] = "completed"
      } else if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
        results[fg.id] = "still-running"
      } else {
        await handleGenerationError(db, fg, `fal status: ${status}`)
        results[fg.id] = `error:${status}`
      }
    } catch (e) {
      results[fg.id] = `reconcile-error: ${e instanceof Error ? e.message : "unknown"}`
    }
  }

  // concurrency-gate sweep: submit queued groups into any free slots (rescues
  // groups left queued when the gate was at capacity)
  await kickQueued(db)

  // reel sweep: fail renders stuck >15 min, then render queued reels whose
  // after() kick died (conditional claim makes duplicate kicks no-ops)
  await db
    .from("reels")
    .update({ status: "failed", error: "render timed out — regenerate" })
    .eq("status", "rendering")
    .lt("started_at", new Date(Date.now() - 15 * 60_000).toISOString())
  const { data: queuedReels } = await db.from("reels").select("id").eq("status", "queued")
  for (const r of queuedReels ?? []) {
    await renderReel(db, r.id)
    results[`reel:${r.id}`] = "rendered"
  }

  return NextResponse.json({ checked: stuck?.length ?? 0, results })
}
