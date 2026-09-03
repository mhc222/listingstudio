// Phase 55 refresh discipline. Unit-tests the pure helpers and measures the
// before/after router.refresh() and localStorage persist counts for a
// simulated 10-photo upload with a counted mock, time scaled 1 s = 20 ms.
import { readFileSync } from "node:fs"
import { coalesce, realtimeInFilters } from "../lib/refresh-discipline.ts"

// lib/upload-queue.ts imports through the "@/" alias, which plain node cannot
// resolve, so the contract constants are read from source.
const contract = readFileSync(new URL("../lib/upload-queue.ts", import.meta.url), "utf8")
const constant = (name) => Number(contract.match(new RegExp(`export const ${name} = (\\d+)`))[1])
const UPLOAD_REFRESH_INTERVAL_MS = constant("UPLOAD_REFRESH_INTERVAL_MS")
const UPLOAD_REFRESH_DRAIN_MS = constant("UPLOAD_REFRESH_DRAIN_MS")
const UPLOAD_PERSIST_THROTTLE_MS = constant("UPLOAD_PERSIST_THROTTLE_MS")

let assertions = 0
function assert(condition, message) {
  assertions += 1
  if (!condition) throw new Error(message)
}
function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}
function contains(source, value, message) {
  assert(source.includes(value), message)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const SCALE = 20 / 1000 // 1 real second = 20 ms of test time
const scaled = (ms) => Math.max(1, Math.round(ms * SCALE))

// --- realtime filters -------------------------------------------------------
assert(realtimeInFilters("job_id", []).length === 0, "empty scope must not subscribe")
assert(realtimeInFilters("job_id", ["", "a", "a", "b"]).join() === "job_id=in.(a,b)", "ids are de-duplicated and blanks dropped")
const many = Array.from({ length: 95 }, (_, index) => `id-${index}`)
const chunks = realtimeInFilters("file_group_id", many)
assert(chunks.length === 3, "95 ids split into three bindings of at most 40")
assert(chunks.every((filter) => filter.split(",").length <= 40), "no binding exceeds the chunk size")
assert(chunks[2] === `file_group_id=in.(${many.slice(80).join(",")})`, "last chunk carries the remainder")

// --- coalesce primitive -----------------------------------------------------
{
  let runs = 0
  const throttle = coalesce(() => { runs += 1 }, { minIntervalMs: 40 })
  throttle.request(); await sleep(5)
  assert(runs === 1, "first throttled request runs immediately")
  throttle.request(); throttle.request(); throttle.request()
  await sleep(20)
  assert(runs === 1, "requests inside the interval wait")
  await sleep(40)
  assert(runs === 2, "trailing request runs once after the interval")
  throttle.request({ minIntervalMs: 0 }); await sleep(5)
  assert(runs === 3, "a per-request override can run sooner")
  throttle.request(); throttle.cancel(); await sleep(60)
  assert(runs === 3, "cancel drops the pending run")
  throttle.flush()
  assert(runs === 4, "flush runs synchronously")
  assert(!throttle.pending(), "nothing pending after flush")
}
{
  let runs = 0
  const debounce = coalesce(() => { runs += 1 }, { delayMs: 30, maxWaitMs: 60 })
  debounce.request(); await sleep(10); debounce.request(); await sleep(10); debounce.request()
  await sleep(15)
  assert(runs === 0, "debounce waits for the quiet period")
  await sleep(30)
  assert(runs === 1, "debounced burst runs once")
  for (let tick = 0; tick < 12; tick += 1) { debounce.request(); await sleep(10) }
  assert(runs >= 2, "maxWait prevents a continuous burst from starving the refresh")
}

// --- upload path measurement ----------------------------------------------
// Ten photos, three concurrent slots, each slot finishing a photo about every
// 8 s of transfer + finalize, so one finalize lands roughly every 2.7 s.
async function simulateBatch({ spacingMs, oldDebounceMs }) {
  const finalizeTimes = Array.from({ length: 10 }, (_, index) => (index + 1) * spacingMs)
  let before = 0
  let beforeTimer = null
  let after = 0
  const runner = coalesce(() => { after += 1 }, { minIntervalMs: scaled(UPLOAD_REFRESH_INTERVAL_MS) })
  const start = Date.now()
  for (const [index, at] of finalizeTimes.entries()) {
    await sleep(Math.max(0, start + scaled(at) - Date.now()))
    // before: the pre-Phase-55 350 ms debounce per finalized item
    if (beforeTimer) clearTimeout(beforeTimer)
    beforeTimer = setTimeout(() => { before += 1 }, scaled(oldDebounceMs))
    // after: throttled while busy, near-immediate when the batch drains
    const drained = index === finalizeTimes.length - 1
    runner.request(drained ? { minIntervalMs: scaled(UPLOAD_REFRESH_DRAIN_MS) } : undefined)
  }
  await sleep(scaled(UPLOAD_REFRESH_INTERVAL_MS) + 30)
  return { before, after }
}
const realistic = await simulateBatch({ spacingMs: 2700, oldDebounceMs: 350 })
assert(realistic.before === 10, `baseline refreshes once per photo (got ${realistic.before})`)
assert(realistic.after <= 6, `throttled batch refreshes at most a handful of times (got ${realistic.after})`)
const fast = await simulateBatch({ spacingMs: 500, oldDebounceMs: 350 })
assert(fast.before === 10, `baseline still refreshes once per fast photo (got ${fast.before})`)
assert(fast.after <= 2, `fast batch collapses to the drain refresh (got ${fast.after})`)

// Persist path: three concurrent uploads emitting a progress tick every 50 ms
// for 8 s, plus one status transition per item start and finish.
async function simulatePersist() {
  let before = 0
  let after = 0
  const runner = coalesce(() => { after += 1 }, { minIntervalMs: scaled(UPLOAD_PERSIST_THROTTLE_MS) })
  const start = Date.now()
  while (Date.now() - start < scaled(8000)) {
    // one 50 ms slice: three uploads each report progress once
    before += 3 // pre-Phase-55: every tick wrote the whole queue
    runner.request()
    await sleep(1)
  }
  for (let transition = 0; transition < 6; transition += 1) { before += 1; runner.flush() }
  await sleep(scaled(UPLOAD_PERSIST_THROTTLE_MS) + 10)
  return { before, after }
}
const persist = await simulatePersist()
assert(persist.after < persist.before / 5, `persist writes drop by more than 5x (${persist.before} -> ${persist.after})`)

// --- source invariants ------------------------------------------------------
const queue = read("app/listings/[id]/upload-queue.tsx")
contains(queue, "minIntervalMs: UPLOAD_REFRESH_INTERVAL_MS", "upload refresh is not throttled per batch")
contains(queue, "minIntervalMs: UPLOAD_REFRESH_DRAIN_MS", "batch drain does not refresh promptly")
contains(queue, "Math.round((bytesSent / bytesTotal) * 100)", "progress is not rounded to whole percents")
contains(queue, 'addEventListener("pagehide", flush)', "queue does not flush on pagehide")
contains(queue, 'addEventListener("beforeunload", flush)', "queue does not flush on beforeunload")
contains(queue, "persistRunner.flush()", "status transitions do not persist immediately")
assert(!queue.includes("setTimeout(() => router.refresh(), 350)"), "per-item refresh timer still present")

const hook = read("lib/use-live-refresh.ts")
contains(hook, "(body.changed ?? 0) > 0 || (previous !== null && next !== previous)", "poll refresh is not gated on a change")
const route = read("app/api/listings/[id]/reconcile/route.ts")
contains(route, "fingerprint: stillRunning.sort().join(\"|\")", "reconcile does not report a running-set fingerprint")

const progress = read("app/listings/[id]/listing-progress.tsx")
assert(!progress.includes('table: "upload_items"') && !progress.includes('table: "upload_batches"'), "dead upload realtime subscriptions still present")
contains(progress, 'realtimeInFilters("job_id"', "file_groups subscription is not listing-scoped")
contains(progress, 'realtimeInFilters("file_group_id"', "output_versions subscription is not listing-scoped")
contains(progress, "useReconcilePoll({ listingId, active: hasActiveGeneration, refresh })", "listing progress poll is not gated")
const feed = read("app/listings/[id]/job-feed.tsx")
contains(feed, 'table: "jobs", filter: `listing_id=eq.${listingId}`', "activity jobs subscription is not listing-scoped")
contains(feed, "useReconcilePoll({ listingId, active: hasActive, refresh })", "activity poll is not gated")
const workspace = read("app/listings/[id]/f/[fileGroupId]/file-group-workspace.tsx")
contains(workspace, 'table: "file_groups", filter: `job_id=eq.${fg.job_id}`', "workspace file_groups subscription is not job-scoped")
contains(workspace, "useReconcilePoll({ listingId, active: !currentSettled, refresh: liveRefresh })", "workspace poll is not gated")
for (const source of [progress, feed, workspace]) {
  assert(!/postgres_changes", \{ event: "\*", schema: "public", table: "(file_groups|output_versions)" \}/.test(source), "an unfiltered file_groups/output_versions subscription remains")
  contains(source, "useDebouncedRefresh()", "realtime refresh is not debounced")
}

console.log(`Phase 55 refresh discipline: ${assertions} assertions passed`)
console.log(`  10-photo upload, one finalize every 2.7 s: refreshes ${realistic.before} -> ${realistic.after}`)
console.log(`  10-photo upload, one finalize every 0.5 s: refreshes ${fast.before} -> ${fast.after}`)
console.log(`  8 s of 3 concurrent uploads: localStorage writes ${persist.before} -> ${persist.after}`)
