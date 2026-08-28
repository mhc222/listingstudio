// Per-FileGroup state machine: queued -> running -> complete/failed, one step
// of the edit_chain at a time. Every transition is a conditional update so
// duplicate webhooks / concurrent cron runs are no-ops. Server-only.
import type { SupabaseClient } from "@supabase/supabase-js"
import { MODELS, type ProviderKey } from "@/config/models"
import { compilePrompt, type EditStep } from "@/lib/prompts"
import { submitGeneration, getResultImageUrl, extractImageUrl } from "@/lib/imaging"
import { getUrl, list, upload } from "@/lib/storage"

export type FileGroupRow = {
  id: string
  job_id: string
  primary_photo_id: string
  edit_chain: EditStep[]
  comment: string | null
  provider: ProviderKey
  current_step: number
  step_status: string
  fal_request_id: string | null
  retry_count: number
}

const SUBMIT_RETRY_BACKOFF_MS = 1500

function webhookUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL
  // fal can't reach localhost — local dev relies on the reconcile poller instead
  if (!base || base.includes("localhost") || base.includes("127.0.0.1")) return undefined
  return `${base.replace(/\/$/, "")}/api/webhook/fal`
}

async function inputUrlForStep(db: SupabaseClient, fg: FileGroupRow): Promise<string> {
  if (fg.current_step === 0) {
    const { data: photo, error } = await db
      .from("photos")
      .select("storage_path")
      .eq("id", fg.primary_photo_id)
      .single()
    if (error || !photo) throw new Error("primary photo not found")
    return getUrl("originals", photo.storage_path, 6 * 3600, db)
  }
  // chained step: previous step's stored output. retry_count may have advanced
  // since that step completed (it's per-group, not per-step), so find the
  // newest step-{n-1}-r* object instead of computing the path from retry_count.
  const re = new RegExp(`^step-${fg.current_step - 1}-r(\\d+)\\.jpg$`)
  const matches = (await list("outputs", fg.id, db))
    .map((name) => re.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
  if (!matches.length) throw new Error(`output of step ${fg.current_step - 1} not found`)
  return getUrl("outputs", `${fg.id}/${matches[0][0]}`, 6 * 3600, db)
}

// Deterministic per (file group, step, retry) so duplicate completions upsert
// the same object instead of piling up copies.
function stepOutputPath(fg: FileGroupRow, step: number): string {
  return `${fg.id}/step-${step}-r${fg.retry_count}.jpg`
}

/**
 * Claim a queued step and submit it to the provider. No-op if the step is not
 * queued (already claimed elsewhere). Submit failures retry once with backoff,
 * then fail the group.
 */
export async function submitStep(db: SupabaseClient, fileGroupId: string): Promise<void> {
  const { data: fg } = await db
    .from("file_groups")
    .select("*")
    .eq("id", fileGroupId)
    .single<FileGroupRow>()
  if (!fg) return

  // claim: only one caller wins
  const { data: claimed } = await db
    .from("file_groups")
    .update({
      step_status: "running",
      step_started_at: new Date().toISOString(),
      last_error: null,
      fal_request_id: null,
    })
    .eq("id", fg.id)
    .eq("current_step", fg.current_step)
    .eq("step_status", "queued")
    .select("id")
  if (!claimed?.length) return

  const step = fg.edit_chain[fg.current_step]
  if (!step) {
    await failGroup(db, fg, "edit chain has no step at current index")
    return
  }

  try {
    const prompt = compilePrompt(step, fg.comment)
    const imageUrl = await inputUrlForStep(db, fg)
    let requestId: string
    try {
      requestId = await submitGeneration(fg.provider, prompt, imageUrl, webhookUrl())
    } catch {
      // retry once with backoff (CLAUDE.md quality bar)
      await new Promise((r) => setTimeout(r, SUBMIT_RETRY_BACKOFF_MS))
      requestId = await submitGeneration(fg.provider, prompt, imageUrl, webhookUrl())
    }
    await db.from("file_groups").update({ fal_request_id: requestId }).eq("id", fg.id)
  } catch (e) {
    await failGroup(db, fg, e instanceof Error ? e.message : "submit failed")
  }
}

/**
 * Handle a successful generation for a request id. Idempotent: the conditional
 * running->complete transition gates storage of the version and the ledger
 * write, so a duplicate delivery does nothing.
 */
export async function completeStep(
  db: SupabaseClient,
  fg: FileGroupRow,
  resultPayload?: unknown
): Promise<void> {
  if (!fg.fal_request_id) return

  let imageUrl: string
  try {
    imageUrl = resultPayload
      ? extractImageUrl(resultPayload)
      : await getResultImageUrl(fg.provider, fg.fal_request_id)
  } catch (e) {
    await handleGenerationError(db, fg, e instanceof Error ? e.message : "no result image")
    return
  }

  // store the output BEFORE the transition; upsert path makes duplicates harmless
  const outPath = stepOutputPath(fg, fg.current_step)
  const res = await fetch(imageUrl)
  if (!res.ok) {
    await handleGenerationError(db, fg, `result download failed (${res.status})`)
    return
  }
  await upload("outputs", outPath, Buffer.from(await res.arrayBuffer()), "image/jpeg", db)

  // the idempotency gate
  const { data: transitioned } = await db
    .from("file_groups")
    .update({ step_status: "complete" })
    .eq("id", fg.id)
    .eq("fal_request_id", fg.fal_request_id)
    .eq("step_status", "running")
    .select("id")
  if (!transitioned?.length) return // duplicate delivery — no ledger, no advance

  // ledger: exactly one row per successful generation
  const step = fg.edit_chain[fg.current_step]
  const cost = MODELS[fg.provider].costCents
  await db.from("spend_ledger").insert({
    job_id: fg.job_id,
    file_group_id: fg.id,
    edit_type: step?.edit_type ?? null,
    model: MODELS[fg.provider].label,
    cost_cents: cost,
    kind: "generation",
  })
  await db.rpc("increment_job_cost", { p_job_id: fg.job_id, p_cents: cost })

  if (fg.current_step + 1 < fg.edit_chain.length) {
    // advance the chain
    await db
      .from("file_groups")
      .update({
        current_step: fg.current_step + 1,
        step_status: "queued",
        fal_request_id: null,
      })
      .eq("id", fg.id)
      .eq("step_status", "complete")
    await submitStep(db, fg.id)
    return
  }

  // final step: create a version and roll the job up
  const { data: latest } = await db
    .from("output_versions")
    .select("version_number")
    .eq("file_group_id", fg.id)
    .order("version_number", { ascending: false })
    .limit(1)
  const nextVersion = (latest?.[0]?.version_number ?? 0) + 1
  await db.from("output_versions").insert({
    file_group_id: fg.id,
    version_number: nextVersion,
    storage_path: outPath,
  })

  const { data: siblings } = await db
    .from("file_groups")
    .select("id, step_status, current_step, edit_chain")
    .eq("job_id", fg.job_id)
  const allDone = (siblings ?? []).every(
    (s) =>
      s.step_status === "complete" &&
      s.current_step === (s.edit_chain as EditStep[]).length - 1
  )
  if (allDone) {
    await db
      .from("jobs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", fg.job_id)
  }
}

/**
 * Handle a failed generation. First failure auto-retries the step once
 * (conditional transition, so duplicate error deliveries can't double-retry);
 * second failure marks the group and job failed.
 */
export async function handleGenerationError(
  db: SupabaseClient,
  fg: FileGroupRow,
  message: string
): Promise<void> {
  if (fg.retry_count < 1) {
    const { data: requeued } = await db
      .from("file_groups")
      .update({
        step_status: "queued",
        retry_count: fg.retry_count + 1,
        fal_request_id: null,
        last_error: `retrying after: ${message}`,
      })
      .eq("id", fg.id)
      .eq("fal_request_id", fg.fal_request_id!)
      .eq("step_status", "running")
      .select("id")
    if (!requeued?.length) return // duplicate error delivery
    await new Promise((r) => setTimeout(r, SUBMIT_RETRY_BACKOFF_MS))
    await submitStep(db, fg.id)
    return
  }
  await failGroup(db, fg, message)
}

async function failGroup(db: SupabaseClient, fg: FileGroupRow, message: string) {
  const { data: failed } = await db
    .from("file_groups")
    .update({ step_status: "failed", last_error: message })
    .eq("id", fg.id)
    .neq("step_status", "failed")
    .select("id")
  if (!failed?.length) return
  await db.from("jobs").update({ status: "failed" }).eq("id", fg.job_id)
}
