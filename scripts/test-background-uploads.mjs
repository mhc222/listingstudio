// Phase 57 background uploads. Behavioural tests for the claim / deferred
// finalize / cron sweep in lib/intake-finalize.ts against an in-memory
// Supabase mock, the placeholder store, and the token-expiry helper; plus
// contract tests over the route and queue sources (Phase 55 style) for the
// parts that only exist inside Next/React.
import { readFileSync } from "node:fs"
import {
  claimUploadItemForFinalize,
  FINALIZE_STALE_MS,
  FINALIZE_SWEEP_LIMIT,
  finalizeUploadItem,
  recoverStaleUploadItems,
  RESERVED_ABANDONED_MS,
} from "../lib/intake-finalize.ts"
import {
  clearUploadPlaceholders,
  getUploadPlaceholders,
  subscribeUploadPlaceholders,
  syncUploadPlaceholders,
} from "../lib/upload-placeholders.ts"
import {
  BACKGROUND_UPLOAD_NOTICE,
  UPLOAD_FINALIZE_POLL_MS,
  UPLOAD_POLL_MAX_IDS,
  UPLOAD_REFRESH_INTERVAL_MS,
  uploadTokenExpired,
} from "../lib/upload-queue.ts"

let assertions = 0
function assert(condition, message) {
  assertions += 1
  if (!condition) throw new Error(message)
}
function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// --- in-memory Supabase admin mock ------------------------------------------
function mockAdmin(tables, { rpc } = {}) {
  const updates = []
  const rpcCalls = []
  function builder(table) {
    const rows = tables[table] ?? []
    const state = { op: "select", patch: null, filters: [], order: null, limit: null, single: null }
    const exec = () => {
      let matched = rows.filter((row) => state.filters.every((filter) => filter(row)))
      if (state.order) {
        const { key, ascending } = state.order
        matched.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1))
      }
      if (state.limit != null) matched = matched.slice(0, state.limit)
      if (state.op === "update") {
        for (const row of matched) Object.assign(row, state.patch)
        updates.push({ table, patch: state.patch, ids: matched.map((row) => row.id) })
      }
      let data = matched.map((row) => ({ ...row }))
      if (state.single) data = data[0] ?? null
      return { data, error: null }
    }
    const b = {
      select() { return b },
      update(patch) { state.op = "update"; state.patch = patch; return b },
      eq(key, value) { state.filters.push((row) => row[key] === value); return b },
      in(key, values) { state.filters.push((row) => values.includes(row[key])); return b },
      lt(key, value) { state.filters.push((row) => row[key] < value); return b },
      order(key, { ascending = true } = {}) { state.order = { key, ascending }; return b },
      limit(n) { state.limit = n; return b },
      maybeSingle() { state.single = true; return b },
      single() { state.single = true; return b },
      returns() { return b },
      then(resolve, reject) { return Promise.resolve().then(exec).then(resolve, reject) },
    }
    return b
  }
  return {
    updates,
    rpcCalls,
    from: (table) => builder(table),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      if (rpc) return rpc(name, args, tables)
      const item = tables.upload_items.find((row) => row.id === args.p_item_id)
      Object.assign(item, { status: "complete", canonical_storage_path: args.p_canonical_storage_path })
      return { data: item.photo_id, error: null }
    },
  }
}

const NOW = Date.parse("2026-09-03T12:00:00.000Z")
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString()
function itemRow(overrides = {}) {
  return {
    id: "item-1",
    batch_id: "batch-1",
    photo_id: "photo-1",
    listing_id: "listing-1",
    original_filename: "kitchen.jpg",
    declared_content_type: "image/jpeg",
    declared_byte_size: 1000,
    source_extension: "jpg",
    is_floor_plan: false,
    intake_path: "u/l/batch-1/item-1.jpg",
    source_storage_path: "u/l/photo-1/source.jpg",
    canonical_storage_path: null,
    source_content_type: null,
    canonical_content_type: null,
    source_byte_size: null,
    width: null,
    height: null,
    status: "reserved",
    error: null,
    intake_deleted_at: null,
    updated_at: iso(-1000),
    ...overrides,
  }
}
const MATERIALIZED = {
  sourceStoragePath: "u/l/photo-1/source.jpg",
  canonicalStoragePath: "u/l/photo-1/canonical.jpg",
  sourceContentType: "image/jpeg",
  canonicalContentType: "image/jpeg",
  sourceByteSize: 1000,
  width: 4000,
  height: 3000,
  photoMetadata: {
    capturedAt: null, exposureTimeSeconds: null, exposureBiasEv: null, apertureFNumber: null, iso: null,
    focalLengthMm: null, cameraMake: null, cameraModel: null, lensModel: null, sourceMetadata: {},
  },
}
// deps shared by every finalize test; loadItem reads straight from the mock
function testDeps(admin, overrides = {}) {
  const calls = { materialize: 0, cleanup: 0, refresh: 0, log: [] }
  const deps = {
    loadItem: async (client, id) => (await client.from("upload_items").select("*").eq("id", id).maybeSingle()).data,
    materialize: async () => { calls.materialize += 1; return MATERIALIZED },
    cleanupIntake: async () => { calls.cleanup += 1; return true },
    refreshBatch: async () => { calls.refresh += 1 },
    log: (message) => calls.log.push(message),
    ...overrides,
  }
  return { deps, calls }
}

// --- claim ------------------------------------------------------------------
{
  const admin = mockAdmin({ upload_items: [itemRow()] })
  assert((await claimUploadItemForFinalize(admin, { id: "item-1", status: "reserved" }, NOW)) === "claimed", "reserved row is claimed")
  const row = admin.from && (await admin.from("upload_items").select().eq("id", "item-1").maybeSingle()).data
  assert(row.status === "finalizing" && row.updated_at === iso(0), "claim moves reserved → finalizing and stamps updated_at")
}
{
  const admin = mockAdmin({ upload_items: [itemRow({ status: "failed", error: "boom" })] })
  assert((await claimUploadItemForFinalize(admin, { id: "item-1", status: "failed" }, NOW)) === "claimed", "failed row is re-claimed for Retry")
  assert(admin.updates[0].patch.error === null, "re-claim clears the previous error")
}
{
  const admin = mockAdmin({ upload_items: [itemRow({ status: "finalizing", updated_at: iso(-30_000) })] })
  const outcome = await claimUploadItemForFinalize(admin, { id: "item-1", status: "finalizing" }, NOW)
  assert(outcome === "in-progress", `fresh finalizing row is a no-op (got ${outcome})`)
  assert(admin.updates.every((update) => update.ids.length === 0), "fresh finalizing row is not touched")
}
{
  const admin = mockAdmin({ upload_items: [itemRow({ status: "finalizing", updated_at: iso(-FINALIZE_STALE_MS - 1000) })] })
  const outcome = await claimUploadItemForFinalize(admin, { id: "item-1", status: "finalizing" }, NOW)
  assert(outcome === "reclaimed", `stale finalizing row is re-claimed (got ${outcome})`)
  const row = (await admin.from("upload_items").select().eq("id", "item-1").maybeSingle()).data
  assert(row.updated_at === iso(0) && row.status === "finalizing", "re-claim refreshes updated_at so a second caller sees it as fresh")
  assert((await claimUploadItemForFinalize(admin, { id: "item-1", status: "finalizing" }, NOW + 1000)) === "in-progress", "second caller right after a re-claim is a no-op")
}
{
  const admin = mockAdmin({ upload_items: [itemRow({ status: "complete" })] })
  assert((await claimUploadItemForFinalize(admin, { id: "item-1", status: "reserved" }, NOW)) === "complete", "row completed since the caller read it reports complete")
  assert((await claimUploadItemForFinalize(admin, { id: "item-1", status: "canceled" }, NOW)) === "canceled", "canceled item short-circuits")
  assert((await claimUploadItemForFinalize(mockAdmin({ upload_items: [] }), { id: "missing", status: "reserved" }, NOW)) === "conflict", "vanished row is a conflict")
}

// --- deferred body: returns to the caller before materialize finishes -------
{
  const admin = mockAdmin({ upload_items: [itemRow({ status: "finalizing", updated_at: iso(0) })] })
  const gate = deferred()
  const { deps, calls } = testDeps(admin, { materialize: async () => { calls.materialize += 1; await gate.promise; return MATERIALIZED } })
  let settled = false
  const run = finalizeUploadItem("item-1", "user-1", admin, deps).then((result) => { settled = true; return result })
  await sleep(20)
  assert(calls.materialize === 1 && !settled, "materialize is in flight and the body has not settled (the route has already answered 202)")
  const during = (await admin.from("upload_items").select().eq("id", "item-1").maybeSingle()).data
  assert(during.status === "finalizing", "row stays finalizing while materialize runs")
  assert(admin.rpcCalls.length === 0, "RPC not called before materialize resolves")
  gate.resolve()
  const result = await run
  assert(result.status === "complete" && result.photoId === "photo-1", "deferred body completes the item")
  assert(admin.rpcCalls.length === 1 && admin.rpcCalls[0].args.p_user_id === "user-1" && admin.rpcCalls[0].args.p_canonical_storage_path === MATERIALIZED.canonicalStoragePath, "finalize_upload_item RPC called once with the owner and materialized paths")
  assert(calls.cleanup === 1 && calls.refresh === 1, "intake cleanup and batch refresh run after the RPC")
}

// --- failure inside the deferred body marks failed with the message ---------
{
  const admin = mockAdmin({ upload_items: [itemRow({ status: "finalizing", updated_at: iso(0) })] })
  const { deps, calls } = testDeps(admin, { materialize: async () => { throw new Error("stored file size (900) does not match declared size (1000)") } })
  const result = await finalizeUploadItem("item-1", "user-1", admin, deps)
  const row = (await admin.from("upload_items").select().eq("id", "item-1").maybeSingle()).data
  assert(result.status === "failed" && row.status === "failed", "materialize failure marks the row failed")
  assert(row.error === "stored file size (900) does not match declared size (1000)", "failure message is stored so Retry shows why")
  assert(admin.rpcCalls.length === 0 && calls.cleanup === 0, "no RPC or cleanup after a failed materialize")
  assert(calls.log.length === 1, "failure is logged once")
}
{
  // row was canceled between claim and run
  const admin = mockAdmin({ upload_items: [itemRow({ status: "canceled" })] })
  const { deps, calls } = testDeps(admin)
  const result = await finalizeUploadItem("item-1", "user-1", admin, deps)
  assert(result.status === "skipped" && calls.materialize === 0, "a row that is no longer finalizing is skipped untouched")
}
{
  // checkpoint written by an older finalizer: skip materialize
  const admin = mockAdmin({ upload_items: [itemRow({ status: "finalizing", updated_at: iso(0), canonical_storage_path: "u/l/photo-1/canonical.jpg", source_content_type: "image/jpeg", canonical_content_type: "image/jpeg", source_byte_size: 1000 })] })
  const { deps, calls } = testDeps(admin)
  const result = await finalizeUploadItem("item-1", "user-1", admin, deps)
  assert(result.status === "complete" && calls.materialize === 0, "checkpointed row completes without re-materializing")
}
{
  // RPC error but the row is already complete (duplicate run): not marked failed
  const admin = mockAdmin({ upload_items: [itemRow({ status: "finalizing", updated_at: iso(0) })] }, {
    rpc: (name, args, tables) => { tables.upload_items[0].status = "complete"; return { data: null, error: new Error("duplicate") } },
  })
  const { deps, calls } = testDeps(admin)
  const result = await finalizeUploadItem("item-1", "user-1", admin, deps)
  const row = (await admin.from("upload_items").select().eq("id", "item-1").maybeSingle()).data
  assert(result.status === "complete" && row.status === "complete" && calls.cleanup === 1, "a run that loses the race to a completed row reports complete, never failed")
}

// --- cron sweep -------------------------------------------------------------
{
  const rows = []
  for (let index = 0; index < 25; index += 1) {
    rows.push(itemRow({ id: `stale-${index}`, photo_id: `p-stale-${index}`, status: "finalizing", updated_at: iso(-FINALIZE_STALE_MS - (25 - index) * 1000) }))
  }
  for (let index = 0; index < 3; index += 1) {
    rows.push(itemRow({ id: `fresh-${index}`, photo_id: `p-fresh-${index}`, status: "finalizing", updated_at: iso(-10_000) }))
  }
  rows.push(itemRow({ id: "old-reserved-1", photo_id: "p-or-1", status: "reserved", updated_at: iso(-RESERVED_ABANDONED_MS - 60_000) }))
  rows.push(itemRow({ id: "old-reserved-2", photo_id: "p-or-2", status: "reserved", updated_at: iso(-RESERVED_ABANDONED_MS - 120_000) }))
  rows.push(itemRow({ id: "fresh-reserved", photo_id: "p-fr", status: "reserved", updated_at: iso(-60_000) }))
  rows.push(itemRow({ id: "done", photo_id: "p-done", status: "complete", updated_at: iso(-RESERVED_ABANDONED_MS - 60_000) }))
  const admin = mockAdmin({
    upload_items: rows,
    upload_batches: [{ id: "batch-1", listing_id: "listing-1" }],
    listings: [{ id: "listing-1", user_id: "owner-1" }],
  })
  const { deps, calls } = testDeps(admin)
  const sweep = await recoverStaleUploadItems(admin, { now: NOW, deps })
  assert(FINALIZE_SWEEP_LIMIT === 20 && sweep.staleFinalizing === 20, `sweep caps stale finalizing rows at 20 (got ${sweep.staleFinalizing})`)
  assert(calls.materialize === 20 && admin.rpcCalls.length === 20, "each swept row runs the shared finalize body once")
  assert(admin.rpcCalls.every((call) => call.args.p_user_id === "owner-1"), "cron resolves the listing owner for the RPC")
  const byId = new Map(rows.map((row) => [row.id, row]))
  assert(Array.from({ length: 20 }, (_, index) => byId.get(`stale-${index}`).status).every((status) => status === "complete"), "the 20 oldest stale rows are completed")
  assert([20, 21, 22, 23, 24].every((index) => byId.get(`stale-${index}`).status === "finalizing"), "rows beyond the cap wait for the next run")
  assert([0, 1, 2].every((index) => byId.get(`fresh-${index}`).status === "finalizing" && byId.get(`fresh-${index}`).updated_at === iso(-10_000)), "fresh finalizing rows are not touched")
  assert(sweep.abandonedReserved === 2 && byId.get("old-reserved-1").status === "failed" && byId.get("old-reserved-2").error === "upload never completed", "reserved rows older than 24 h fail with the abandonment message")
  assert(byId.get("fresh-reserved").status === "reserved" && byId.get("done").status === "complete", "fresh reserved and complete rows are untouched")
  assert(Object.keys(sweep.finalizing).length === 20 && Object.values(sweep.finalizing).every((outcome) => outcome === "complete"), "sweep reports one outcome per swept row")
}

// --- placeholder store: object URLs created once, revoked on drop/clear -----
{
  const created = [], revoked = []
  const urlApi = {
    createObjectURL: (blob) => { const url = `blob:${blob.type}:${created.length}`; created.push(url); return url },
    revokeObjectURL: (url) => revoked.push(url),
  }
  let notified = 0
  const unsubscribe = subscribeUploadPlaceholders(() => { notified += 1 })
  const jpeg = new Blob(["x"], { type: "image/jpeg" })
  const heic = new Blob(["x"], { type: "image/heic" })
  const first = syncUploadPlaceholders("listing-1", [
    { id: "a", photoId: "pa", name: "a.jpg", isFloorPlan: false, stage: "uploading", file: jpeg },
    { id: "b", photoId: "pb", name: "b.heic", isFloorPlan: false, stage: "uploading", file: heic },
    { id: "c", photoId: "pc", name: "c.jpg", isFloorPlan: false, stage: "processing", file: null },
  ], urlApi)
  assert(first.length === 3 && first[0].previewUrl === created[0] && first[1].previewUrl === null && first[2].previewUrl === null, "jpeg gets an object URL; HEIC and file-less (reloaded) items get a neutral tile")
  assert(created.length === 1 && notified === 1, "one object URL created, subscribers notified once")
  const again = syncUploadPlaceholders("listing-1", [
    { id: "a", photoId: "pa", name: "a.jpg", isFloorPlan: false, stage: "uploading", file: jpeg },
    { id: "b", photoId: "pb", name: "b.heic", isFloorPlan: false, stage: "uploading", file: heic },
    { id: "c", photoId: "pc", name: "c.jpg", isFloorPlan: false, stage: "processing", file: null },
  ], urlApi)
  assert(again === first && created.length === 1 && notified === 1, "an unchanged sync reuses the URL and does not notify (progress ticks stay cheap)")
  const moved = syncUploadPlaceholders("listing-1", [
    { id: "a", photoId: "pa", name: "a.jpg", isFloorPlan: false, stage: "processing", file: jpeg },
  ], urlApi)
  assert(moved.length === 1 && moved[0].stage === "processing" && moved[0].previewUrl === created[0] && revoked.length === 0 && notified === 2, "stage change keeps the same URL and notifies")
  syncUploadPlaceholders("listing-1", [], urlApi)
  assert(revoked.length === 1 && revoked[0] === created[0] && getUploadPlaceholders("listing-1").length === 0, "placeholder object URL revoked when the item leaves the pending set")
  syncUploadPlaceholders("listing-1", [{ id: "d", photoId: "pd", name: "d.jpg", isFloorPlan: false, stage: "uploading", file: jpeg }], urlApi)
  clearUploadPlaceholders("listing-1", urlApi)
  assert(revoked.length === 2 && revoked[1] === created[1] && getUploadPlaceholders("listing-1").length === 0, "unmount clears tiles and revokes every remaining URL")
  unsubscribe()
}

// --- token expiry helper ----------------------------------------------------
assert(uploadTokenExpired({ token: "", tokenExpiresAt: null }, NOW), "missing token must be re-authorized")
assert(!uploadTokenExpired({ token: "t", tokenExpiresAt: null }, NOW), "pre-Phase-57 persisted rows without an expiry are used as-is")
assert(!uploadTokenExpired({ token: "t", tokenExpiresAt: iso(7200_000) }, NOW), "fresh prepare token is reused for the first transfer")
assert(uploadTokenExpired({ token: "t", tokenExpiresAt: iso(30_000) }, NOW), "token inside the renew margin is refreshed before the PUT")
assert(UPLOAD_FINALIZE_POLL_MS === UPLOAD_REFRESH_INTERVAL_MS && UPLOAD_POLL_MAX_IDS === 50, "finalize poll keeps the existing 5 s cadence")

// --- route and client contracts (source) ------------------------------------
const route = read("app/api/uploads/[itemId]/finalize/route.ts")
const cron = read("app/api/cron/reconcile/route.ts")
const recovery = read("app/api/uploads/route.ts")
const queue = read("app/listings/[id]/upload-queue.tsx")
const grid = read("app/listings/[id]/photo-grid.tsx")
const workspace = read("app/listings/[id]/listing-workspace.tsx")

assert(route.includes('import { NextResponse, after } from "next/server"'), "finalize route uses after() from next/server")
assert(/after\(\(\) =>\s*finalizeUploadItem\(item\.id, user\.id, admin\)/.test(route), "finalize body is scheduled inside after(), never awaited")
assert(route.includes("{ status: 202 }") && route.includes('status: "finalizing"'), "route answers 202 { status: \"finalizing\" }")
assert(!route.includes("materializeIntakeItem") && !route.includes('.rpc("finalize_upload_item"'), "route no longer materializes or calls the RPC inline")
{
  const order = ["auth.getUser", "getOwnedUploadItem(supabase, itemId)", "claimUploadItemForFinalize(admin, item)", "after(() =>"].map((anchor) => route.indexOf(anchor))
  assert(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])), "auth → ownership → atomic claim still precede the deferred body")
}
assert(route.includes('case "in-progress"') && route.includes("idempotent: true"), "a second call on a fresh finalizing row is a 202 no-op")
assert(route.includes("maxDuration = 120"), "route keeps maxDuration for the deferred body")
assert(cron.includes("recoverStaleUploadItems(db)") && cron.includes("uploads"), "reconcile cron runs the upload sweep and reports its counts")
assert(recovery.includes('searchParams.get("ids")') && recovery.includes("UPLOAD_POLL_MAX_IDS") && recovery.includes('.eq("status", "open")'), "GET /api/uploads serves the finalize poll by ids while keeping open-batch recovery")

const onSuccess = queue.slice(queue.indexOf("onSuccess: () => {"), queue.indexOf("},", queue.indexOf("onSuccess: () => {")))
assert(onSuccess.includes("activeIds.current.delete(item.id)") && onSuccess.includes('status: "finalizing"') && !onSuccess.includes("finalizeItem("), "transfer slot is released when the PUT completes, before finalize")
assert(queue.includes("void finalizeItem(item.id)") && !queue.includes("await finalizeItem("), "scheduler fires finalize without awaiting it")
assert(!queue.includes('(item.status === "finalizing" && item.transferComplete))') && queue.includes('item.status === "waiting" && !item.paused && item.file'), "finalizing items no longer consume a transfer slot")
assert(queue.includes("finalizeRequested.current.has(item.id)") && queue.includes("finalizeRequested.current.delete(item.id)"), "exactly one finalize POST per transfer, Retry re-arms it")
assert(queue.includes('"x-signature": token') && queue.includes("if (uploadTokenExpired(item, Date.now()))") && (queue.match(/\/authorize`/g) ?? []).length === 1, "first PUT uses the prepare token; /authorize only when missing or expiring")
assert(queue.includes("&ids=${ids.join(\",\")}") && queue.includes("UPLOAD_FINALIZE_POLL_MS"), "queue polls the finalizing rows to learn completion")
assert(queue.includes("syncUploadPlaceholders(") && queue.includes("clearUploadPlaceholders(listingId)"), "queue publishes placeholders and clears them on unmount")
assert(queue.includes("{BACKGROUND_UPLOAD_NOTICE}") && BACKGROUND_UPLOAD_NOTICE.startsWith("Uploads continue in the background"), "one background-upload notice per batch, not a blocking spinner")
assert(grid.includes("pending.map((item) => <PlaceholderTile") && grid.includes('processing: "Processing"') && grid.includes("!photos.length && !pending.length"), "grid renders placeholder tiles with a Processing badge")
assert(workspace.includes("usePendingUploads(listingId)") && workspace.includes("pending={pendingTiles}") && workspace.includes("seenPhotoIds"), "workspace feeds the grid and drops a placeholder once its photo row appears")

console.log(`test-background-uploads: ${assertions} assertions passed`)
