import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyFalWebhook } from "@/lib/imaging"
import { completeStep, handleGenerationError, type FileGroupRow } from "@/lib/orchestrator"

// fal delivers per-request results here. Signature is verified before acting;
// all state transitions downstream are conditional updates, so redelivery is a no-op.
export async function POST(req: Request) {
  const rawBody = Buffer.from(await req.arrayBuffer())

  const valid = await verifyFalWebhook(rawBody, {
    requestId: req.headers.get("x-fal-webhook-request-id"),
    userId: req.headers.get("x-fal-webhook-user-id"),
    timestamp: req.headers.get("x-fal-webhook-timestamp"),
    signature: req.headers.get("x-fal-webhook-signature"),
  }).catch(() => false)
  if (!valid) return NextResponse.json({ error: "invalid signature" }, { status: 401 })

  const body = JSON.parse(rawBody.toString()) as {
    request_id: string
    status: "OK" | "ERROR"
    payload?: unknown
    error?: string
  }

  const db = createAdminClient()
  const { data: fg } = await db
    .from("file_groups")
    .select("*")
    .eq("fal_request_id", body.request_id)
    .single<FileGroupRow>()
  // unknown request id: already transitioned (stale delivery) — acknowledge
  if (!fg) return NextResponse.json({ ok: true })

  if (body.status === "OK") {
    await completeStep(db, fg, body.payload)
  } else {
    await handleGenerationError(db, fg, body.error ?? "generation failed")
  }
  return NextResponse.json({ ok: true })
}
