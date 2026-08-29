// Per-FileGroup state machine: queued -> running -> complete/failed, one step
// of the edit_chain at a time. Every transition is a conditional update so
// duplicate webhooks / concurrent cron runs are no-ops. Server-only.
import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"
import { MODELS, INTERPRETER_MODEL, type ProviderKey } from "@/config/models"
import {
  compileNegative,
  compilePrompt,
  EDIT_360_BASE,
  type EditStep,
  type Grounding,
  type ReworkOptions,
} from "@/lib/prompts"
import { submitGeneration, getResultImageUrl, extractImageUrl } from "@/lib/imaging"
import { getUrl, list, upload } from "@/lib/storage"
import { runQA } from "@/lib/qa"
import { isStaged } from "@/lib/deliver"

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
  qa_retry_count: number
}

const SUBMIT_RETRY_BACKOFF_MS = 1500

// ---- Experimental 360 edits (phase 17) ----
// A 360 chain (REWORK steps included — they ride the same chain) generates at
// the largest safe 2:1 size qwen accepts, then the output is resized back to
// the source pano's exact dimensions so the tour viewer gets a full-res
// equirect. ponytail: lanczos upscale, not Real-ESRGAN — add the fal upscale
// call if pano sharpness disappoints.
export function is360Chain(chain: EditStep[]): boolean {
  return chain.some((s) => s.edit_type in EDIT_360_BASE)
}
const PANO_GEN_SIZE = { width: 2048, height: 1024 }
export const SEAM_REVIEW_NOTE =
  "Experimental 360 output — manually review the seam (left/right edge join) and the zenith/nadir poles before delivering."

// Concurrency gate (CLAUDE.md: batch = many machines behind a gate, max 3).
// Best-effort ±1 under concurrent webhooks — it protects fal rate limits, not
// correctness; the reconcile cron sweeps queued groups every minute.
const MAX_CONCURRENT_RUNNING = 3

async function runningCount(db: SupabaseClient): Promise<number> {
  const { count } = await db
    .from("file_groups")
    .select("id", { count: "exact", head: true })
    .eq("step_status", "running")
  return count ?? 0
}

/**
 * Submit queued groups up to the free slots under the gate. Queued groups with
 * a null fal_request_id are the un-submitted ones (a claimed step gets its
 * request id right after submit; requeues null it out).
 */
export async function kickQueued(db: SupabaseClient): Promise<void> {
  const free = MAX_CONCURRENT_RUNNING - (await runningCount(db))
  if (free <= 0) return
  const { data: queued } = await db
    .from("file_groups")
    .select("id")
    .eq("step_status", "queued")
    .is("fal_request_id", null)
    .order("created_at")
    .limit(free)
  for (const fg of queued ?? []) await submitStep(db, fg.id)
}

function webhookUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL
  // fal can't reach localhost — local dev relies on the reconcile poller instead
  if (!base || base.includes("localhost") || base.includes("127.0.0.1")) return undefined
  return `${base.replace(/\/$/, "")}/api/webhook/fal`
}

async function inputUrlForStep(db: SupabaseClient, fg: FileGroupRow): Promise<string> {
  // rework steps edit the specific version they branch from, not the chain
  const step = fg.edit_chain[fg.current_step]
  if (step?.edit_type === "REWORK") {
    const source = (step.options as ReworkOptions)?.source_path
    if (!source) throw new Error("rework step has no source_path")
    return getUrl("outputs", source, 6 * 3600, db)
  }
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

// Grounding computed at job creation (jobs.grounding_used); the compiler
// injects the dimension sentence into groundable templates.
async function groundingFor(db: SupabaseClient, fg: FileGroupRow): Promise<Grounding | undefined> {
  const { data: job } = await db
    .from("jobs")
    .select("grounding_used")
    .eq("id", fg.job_id)
    .single<{ grounding_used: { dimension_sentence?: string } | null }>()
  const sentence = job?.grounding_used?.dimension_sentence
  return sentence ? { dimensions: sentence } : undefined
}

// Reference images (sample library + auto-attached floor plan) as signed URLs.
async function refUrlsFor(db: SupabaseClient, fg: FileGroupRow): Promise<string[]> {
  const { data: refs } = await db
    .from("file_group_refs")
    .select("photos(storage_path), sample_images(storage_path)")
    .eq("file_group_id", fg.id)
  // supabase-js types to-one joins as arrays without generated DB types
  const one = (v: unknown) =>
    (Array.isArray(v) ? v[0] : v) as { storage_path: string } | null | undefined
  const urls: string[] = []
  for (const ref of refs ?? []) {
    const photo = one(ref.photos)
    const sample = one(ref.sample_images)
    if (photo) urls.push(await getUrl("originals", photo.storage_path, 6 * 3600, db))
    else if (sample) urls.push(await getUrl("references", sample.storage_path, 6 * 3600, db))
  }
  return urls
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

  // gate: at capacity, leave the step queued for kickQueued / the cron sweep
  if ((await runningCount(db)) >= MAX_CONCURRENT_RUNNING) return

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
    const prompt = compilePrompt(step, fg.comment, await groundingFor(db, fg))
    const imageUrl = await inputUrlForStep(db, fg)
    const refUrls = await refUrlsFor(db, fg)
    // 360 chains run on qwen (forced at the jobs route), which accepts an
    // explicit output size — skip the default ~1MP downscale
    const extra: Record<string, unknown> = {}
    if (is360Chain(fg.edit_chain)) extra.image_size = PANO_GEN_SIZE
    // negative_prompt is a qwen-only input; gemini/kontext don't take one
    const negative = fg.provider === "qwen" ? compileNegative(step) : null
    if (negative) extra.negative_prompt = negative
    let requestId: string
    try {
      requestId = await submitGeneration(fg.provider, prompt, imageUrl, webhookUrl(), refUrls, extra)
    } catch {
      // retry once with backoff (CLAUDE.md quality bar)
      await new Promise((r) => setTimeout(r, SUBMIT_RETRY_BACKOFF_MS))
      requestId = await submitGeneration(fg.provider, prompt, imageUrl, webhookUrl(), refUrls, extra)
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
  let outBuf = Buffer.from(await res.arrayBuffer())
  // full-res 360 path: resize the generation back to the source pano's exact
  // dimensions so the equirect wraps the sphere at original resolution
  if (is360Chain(fg.edit_chain)) {
    const { data: pano } = await db
      .from("photos")
      .select("width, height")
      .eq("id", fg.primary_photo_id)
      .single<{ width: number | null; height: number | null }>()
    if (pano?.width && pano?.height) {
      const meta = await sharp(outBuf).metadata()
      if (meta.width !== pano.width || meta.height !== pano.height) {
        outBuf = Buffer.from(
          await sharp(outBuf)
            .resize(pano.width, pano.height, { fit: "fill" })
            .jpeg({ quality: 92 })
            .toBuffer()
        )
      }
    }
  }
  await upload("outputs", outPath, outBuf, "image/jpeg", db)

  // the idempotency gate
  const { data: transitioned } = await db
    .from("file_groups")
    .update({ step_status: "complete" })
    .eq("id", fg.id)
    .eq("fal_request_id", fg.fal_request_id)
    .eq("step_status", "running")
    .select("id")
  if (!transitioned?.length) return // duplicate delivery — no ledger, no advance

  // ledger: exactly one row per successful generation. Ideas jobs were
  // counted upfront as ONE ideas entry (4 calls), so their completions skip
  // the ledger — except retries, which are extra calls and always counted.
  const step = fg.edit_chain[fg.current_step]
  const isRework = step?.edit_type === "REWORK"
  const { data: jobRow } = await db
    .from("jobs")
    .select("kind")
    .eq("id", fg.job_id)
    .single<{ kind: string }>()
  const isIdeasJob = jobRow?.kind === "ideas"
  const cost = MODELS[fg.provider].costCents
  if (!isIdeasJob || isRework || fg.retry_count > 0) {
    await db.from("spend_ledger").insert({
      job_id: fg.job_id,
      file_group_id: fg.id,
      edit_type: step?.edit_type ?? null,
      model: MODELS[fg.provider].label,
      cost_cents: cost,
      kind: isRework ? "rework" : "generation",
    })
    await db.rpc("increment_job_cost", { p_job_id: fg.job_id, p_cents: cost })
  }

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
  const { data: inserted } = await db
    .from("output_versions")
    .insert({
      file_group_id: fg.id,
      version_number: nextVersion,
      storage_path: outPath,
      // 360 outputs ship pre-flagged for manual seam/pole review (auto-QA is
      // skipped below, so nothing overwrites this)
      qa_note: is360Chain(fg.edit_chain) ? SEAM_REVIEW_NOTE : null,
      parent_version_id: isRework
        ? ((step!.options as ReworkOptions).parent_version_id ?? null)
        : null,
    })
    .select("id")
    .single()

  // Auto-QA (phase 8): vision pass on every delivered version. Never blocks —
  // a failed QA call records a skipped note and the version still ships.
  // Ideas variants skip QA: they're exploratory; the promoted one gets QA'd
  // through its rework cycle. Floor plan redraws skip QA too — the QA prompt
  // judges photo geometry, which a sketch->plan redraw legitimately "violates".
  // Portrait retouches skip QA for the same reason: the prompt judges real
  // estate photo geometry, not faces (phase 14).
  // 360 chains skip QA too: the QA prompt judges flat listing-photo geometry,
  // which equirect distortion legitimately "violates" (phase 17) — the seam
  // review note stands in as the verdict.
  const skipsQA =
    fg.edit_chain.some((s) => ["FLOOR_PLAN_REDRAW", "PORTRAIT_RETOUCHING"].includes(s.edit_type)) ||
    is360Chain(fg.edit_chain)
  if ((isIdeasJob && !isRework) || skipsQA) {
    const { data: siblingsIdeas } = await db
      .from("file_groups")
      .select("id, step_status, current_step, edit_chain")
      .eq("job_id", fg.job_id)
    const allDoneIdeas = (siblingsIdeas ?? []).every(
      (s) =>
        s.step_status === "complete" &&
        s.current_step === (s.edit_chain as EditStep[]).length - 1
    )
    if (allDoneIdeas) {
      await db
        .from("jobs")
        .update({ status: "complete", completed_at: new Date().toISOString() })
        .eq("id", fg.job_id)
    }
    await kickQueued(db) // this group's slot is free
    return
  }
  const verdict = await runQA(db, fg, outPath)
  if (verdict.costCents > 0) {
    await db.from("spend_ledger").insert({
      job_id: fg.job_id,
      file_group_id: fg.id,
      edit_type: step?.edit_type ?? null,
      model: INTERPRETER_MODEL.label,
      cost_cents: verdict.costCents,
      kind: "qa",
    })
    await db.rpc("increment_job_cost", { p_job_id: fg.job_id, p_cents: verdict.costCents })
  }
  if (inserted) {
    // MLS compliance checklist (phase 21): vision checks from the same QA call
    // plus the metadata "Virtually Staged" label check for staged chains (the
    // label defaults ON at download; a label-off download flips it to fail).
    // Flags only — nothing here blocks delivery.
    const complianceChecks = [
      ...(isStaged(fg.edit_chain)
        ? [
            {
              id: "virtually_staged_label",
              label: '"Virtually Staged" label on download',
              pass: true,
              note: "label defaults ON at download",
            },
          ]
        : []),
      ...(verdict.checks ?? []),
    ]
    const patch: Record<string, unknown> = { qa_note: verdict.note }
    if (complianceChecks.length)
      patch.compliance = { checked_at: new Date().toISOString(), checks: complianceChecks }
    const { error: cErr } = await db.from("output_versions").update(patch).eq("id", inserted.id)
    // pre-migration-0008 the compliance column doesn't exist — keep the qa_note
    if (cErr && patch.compliance)
      await db.from("output_versions").update({ qa_note: verdict.note }).eq("id", inserted.id)
  }

  // QA failure: one auto-retry as a system rework, cap enforced as a state
  // transition on qa_retry_count (a concurrent duplicate loses the update).
  if (!verdict.pass && verdict.corrective && fg.qa_retry_count === 0) {
    const qaStep: EditStep = {
      edit_type: "REWORK",
      options: {
        instructions: verdict.corrective,
        source_path: outPath,
        parent_version_id: inserted?.id,
      },
    }
    const { data: appended } = await db
      .from("file_groups")
      .update({
        edit_chain: [...fg.edit_chain, qaStep],
        current_step: fg.edit_chain.length,
        step_status: "queued",
        retry_count: 0,
        fal_request_id: null,
        qa_retry_count: 1,
      })
      .eq("id", fg.id)
      .eq("step_status", "complete")
      .eq("qa_retry_count", 0)
      .select("id")
    if (appended?.length) {
      await submitStep(db, fg.id)
      return // job stays processing until the QA rework lands
    }
  }

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
  await kickQueued(db) // this group's slot is free
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
  await kickQueued(db) // this group's slot is free
}
