// Phase 57: the finalize body (materialize → RPC → cleanup → batch refresh)
// runs after the response, inside Next `after()` from the route and from the
// reconcile cron for rows whose deferred run died. One function, two callers.
//
// Node-loadable for `scripts/test-background-uploads.mjs`: the heavy
// dependencies (sharp, storage, the "@/" alias) are loaded lazily and can be
// injected, mirroring the Phase 56 lazy-import pattern in lib/storage.ts.
import type { SupabaseClient } from "@supabase/supabase-js"
import type { IntakeItem, MaterializedIntake } from "./intake.ts"
import type { OwnedUploadItem } from "./intake-lifecycle.ts"

// A `finalizing` row older than this is presumed orphaned (its after() body
// died or the function timed out) and may be re-claimed and re-run.
export const FINALIZE_STALE_MS = 3 * 60_000
// A `reserved` row this old never finished transferring; it stops counting as
// in flight so batch status can settle.
export const RESERVED_ABANDONED_MS = 24 * 60 * 60_000
export const FINALIZE_SWEEP_LIMIT = 20

export type FinalizeDeps = {
  loadItem: (client: SupabaseClient, itemId: string) => Promise<OwnedUploadItem | null>
  materialize: (item: IntakeItem, admin: SupabaseClient) => Promise<MaterializedIntake>
  cleanupIntake: (
    item: Pick<OwnedUploadItem, "id" | "intake_path" | "intake_deleted_at">,
    admin: SupabaseClient
  ) => Promise<boolean>
  refreshBatch: (batchId: string, admin: SupabaseClient) => Promise<void>
  log: (message: string, error?: unknown) => void
}

let defaultDepsPromise: Promise<FinalizeDeps> | null = null
function defaultDeps(): Promise<FinalizeDeps> {
  defaultDepsPromise ??= Promise.all([import("./intake.ts"), import("./intake-lifecycle.ts")]).then(
    ([intake, lifecycle]) => ({
      loadItem: lifecycle.getOwnedUploadItem,
      materialize: intake.materializeIntakeItem,
      cleanupIntake: lifecycle.cleanupIntakeObject,
      refreshBatch: lifecycle.refreshUploadBatchStatus,
      log: (message, error) => console.error(message, error),
    })
  )
  return defaultDepsPromise
}

const DEP_KEYS: Array<keyof FinalizeDeps> = ["loadItem", "materialize", "cleanupIntake", "refreshBatch", "log"]
// Only touch the real (sharp/storage) modules when a dep was not injected.
async function resolveDeps(injected?: Partial<FinalizeDeps>): Promise<FinalizeDeps> {
  if (injected && DEP_KEYS.every((key) => injected[key])) return injected as FinalizeDeps
  return { ...(await defaultDeps()), ...injected }
}

export type ClaimOutcome =
  | "claimed" // reserved|failed → finalizing; caller must run finalizeUploadItem
  | "reclaimed" // stale finalizing → fresh finalizing; caller must run it again
  | "in-progress" // fresh finalizing; nothing to do
  | "complete"
  | "canceled"
  | "conflict"

// The atomic claim. Conditional updates keep it idempotent: two concurrent
// callers cannot both win, and a fresh `finalizing` row is left alone unless
// its updated_at is older than FINALIZE_STALE_MS.
export async function claimUploadItemForFinalize(
  admin: SupabaseClient,
  item: Pick<OwnedUploadItem, "id" | "status">,
  now: number = Date.now()
): Promise<ClaimOutcome> {
  if (item.status === "canceled") return "canceled"
  if (item.status === "complete") return "complete"
  const nowIso = new Date(now).toISOString()

  const { data: claimed, error } = await admin
    .from("upload_items")
    .update({ status: "finalizing", error: null, updated_at: nowIso })
    .eq("id", item.id)
    .in("status", ["reserved", "failed"])
    .select("status")
    .maybeSingle()
  if (error) throw new Error("could not begin finalization")
  if (claimed) return "claimed"

  const { data: latest } = await admin
    .from("upload_items")
    .select("status, updated_at")
    .eq("id", item.id)
    .maybeSingle()
  if (!latest) return "conflict"
  if (latest.status === "canceled") return "canceled"
  if (latest.status === "complete") return "complete"
  if (latest.status !== "finalizing") return "conflict"

  const staleCutoff = new Date(now - FINALIZE_STALE_MS).toISOString()
  if (latest.updated_at >= staleCutoff) return "in-progress"
  const { data: reclaimed } = await admin
    .from("upload_items")
    .update({ updated_at: nowIso, error: null })
    .eq("id", item.id)
    .eq("status", "finalizing")
    .lt("updated_at", staleCutoff)
    .select("status")
    .maybeSingle()
  return reclaimed ? "reclaimed" : "in-progress"
}

export type FinalizeResult =
  | { status: "complete"; photoId: string | null; cleanupPending: boolean }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: string }

// Runs the deferred body for an item the caller has already claimed. Never
// throws: a failure marks the row `failed` with the message (conditional on it
// still being `finalizing`) so the client's Retry appears. Materialize and the
// RPC are idempotent, so a re-run after a stale re-claim is safe.
export async function finalizeUploadItem(
  itemId: string,
  userId: string,
  admin: SupabaseClient,
  injected?: Partial<FinalizeDeps>
): Promise<FinalizeResult> {
  const deps = await resolveDeps(injected)
  const item = await deps.loadItem(admin, itemId)
  if (!item) return { status: "skipped", reason: "upload item not found" }
  if (item.status !== "finalizing") {
    return { status: "skipped", reason: `upload item is ${item.status}` }
  }

  try {
    // A row-created/status-not-finished checkpoint (data written by an older
    // finalizer) skips materialize so the already-cleaned intake object is not
    // required; otherwise materialize from the intake object.
    const materialized: MaterializedIntake =
      item.canonical_storage_path &&
      item.source_content_type &&
      item.canonical_content_type &&
      item.source_byte_size
        ? {
            sourceStoragePath: item.source_storage_path,
            canonicalStoragePath: item.canonical_storage_path,
            sourceContentType: item.source_content_type,
            canonicalContentType: item.canonical_content_type,
            sourceByteSize: item.source_byte_size,
            width: item.width,
            height: item.height,
            photoMetadata: {
              capturedAt: null,
              exposureTimeSeconds: null,
              exposureBiasEv: null,
              apertureFNumber: null,
              iso: null,
              focalLengthMm: null,
              cameraMake: null,
              cameraModel: null,
              lensModel: null,
              sourceMetadata: {},
            },
          }
        : await deps.materialize(item, admin)

    const { data: photoId, error } = await admin.rpc("finalize_upload_item", {
      p_item_id: item.id,
      p_user_id: userId,
      p_source_storage_path: materialized.sourceStoragePath,
      p_canonical_storage_path: materialized.canonicalStoragePath,
      p_source_content_type: materialized.sourceContentType,
      p_canonical_content_type: materialized.canonicalContentType,
      p_source_byte_size: materialized.sourceByteSize,
      p_width: materialized.width,
      p_height: materialized.height,
      p_captured_at: materialized.photoMetadata.capturedAt,
      p_exposure_time_seconds: materialized.photoMetadata.exposureTimeSeconds,
      p_exposure_bias_ev: materialized.photoMetadata.exposureBiasEv,
      p_aperture_f_number: materialized.photoMetadata.apertureFNumber,
      p_iso: materialized.photoMetadata.iso,
      p_focal_length_mm: materialized.photoMetadata.focalLengthMm,
      p_camera_make: materialized.photoMetadata.cameraMake,
      p_camera_model: materialized.photoMetadata.cameraModel,
      p_lens_model: materialized.photoMetadata.lensModel,
      p_source_metadata: materialized.photoMetadata.sourceMetadata,
    })
    if (error) throw error

    const latest = (await deps.loadItem(admin, item.id)) ?? item
    const cleaned = await deps.cleanupIntake(latest, admin)
    await deps.refreshBatch(item.batch_id, admin)
    return { status: "complete", photoId: (photoId as string | null) ?? item.photo_id, cleanupPending: !cleaned }
  } catch (error) {
    const { data: latest } = await admin
      .from("upload_items")
      .select("status, photo_id, intake_deleted_at, intake_path")
      .eq("id", item.id)
      .maybeSingle()
    if (latest?.status === "complete") {
      const cleaned = await deps.cleanupIntake(
        { id: item.id, intake_path: latest.intake_path, intake_deleted_at: latest.intake_deleted_at },
        admin
      )
      return { status: "complete", photoId: latest.photo_id, cleanupPending: !cleaned }
    }

    const message = (error instanceof Error ? error.message : "finalization failed") || "finalization failed"
    deps.log(`finalize ${item.id} failed: ${message}`, error)
    await admin
      .from("upload_items")
      .update({ status: "failed", error: message.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("status", "finalizing")
    return { status: "failed", error: message }
  }
}

export type StaleUploadSweep = {
  staleFinalizing: number
  finalizing: Record<string, string>
  abandonedReserved: number
}

// Cron recovery: re-run stale `finalizing` rows (cap FINALIZE_SWEEP_LIMIT per
// run) and fail `reserved` rows nobody transferred in RESERVED_ABANDONED_MS.
export async function recoverStaleUploadItems(
  admin: SupabaseClient,
  options: { now?: number; limit?: number; deps?: Partial<FinalizeDeps> } = {}
): Promise<StaleUploadSweep> {
  const now = options.now ?? Date.now()
  const limit = options.limit ?? FINALIZE_SWEEP_LIMIT
  const staleCutoff = new Date(now - FINALIZE_STALE_MS).toISOString()
  const sweep: StaleUploadSweep = { staleFinalizing: 0, finalizing: {}, abandonedReserved: 0 }

  const { data: stale } = await admin
    .from("upload_items")
    .select("id, status, updated_at, batch_id")
    .eq("status", "finalizing")
    .lt("updated_at", staleCutoff)
    .order("updated_at", { ascending: true })
    .limit(limit)
  for (const row of stale ?? []) {
    sweep.staleFinalizing += 1
    try {
      const outcome = await claimUploadItemForFinalize(admin, row, now)
      if (outcome !== "reclaimed") {
        sweep.finalizing[row.id] = outcome
        continue
      }
      const { data: batch } = await admin
        .from("upload_batches")
        .select("listing_id")
        .eq("id", row.batch_id)
        .maybeSingle()
      const { data: listing } = batch
        ? await admin.from("listings").select("user_id").eq("id", batch.listing_id).maybeSingle()
        : { data: null }
      if (!listing?.user_id) {
        await admin
          .from("upload_items")
          .update({ status: "failed", error: "owner not found", updated_at: new Date(now).toISOString() })
          .eq("id", row.id)
          .eq("status", "finalizing")
        sweep.finalizing[row.id] = "failed:no-owner"
        continue
      }
      const result = await finalizeUploadItem(row.id, listing.user_id, admin, options.deps)
      sweep.finalizing[row.id] =
        result.status === "failed" ? `failed:${result.error}` : result.status
    } catch (error) {
      sweep.finalizing[row.id] = `sweep-error: ${error instanceof Error ? error.message : "unknown"}`
    }
  }

  const abandonedCutoff = new Date(now - RESERVED_ABANDONED_MS).toISOString()
  const { data: abandoned } = await admin
    .from("upload_items")
    .update({
      status: "failed",
      error: "upload never completed",
      updated_at: new Date(now).toISOString(),
    })
    .eq("status", "reserved")
    .lt("updated_at", abandonedCutoff)
    .select("id")
  sweep.abandonedReserved = abandoned?.length ?? 0
  return sweep
}
