# Listing Studio — full code review, 2026-09-03

Read-only review at working tree `a382ca3` + uncommitted `CLAUDE.md` / `docs/claude-reference.md`.
No builds, no dev server, no generation, no writes outside this file.

---

## Executive summary

1. Matt's "3 calls per photo" is close: 1 batched reserve (`/api/uploads/prepare`, amortised 1/N) + 1–3 direct TUS requests to Supabase + 1 `/api/uploads/{id}/finalize`. The call *count* is already near optimal.
2. The invisible fourth call is the problem: every finalize fires `router.refresh()`, which re-runs the whole `/listings/[id]` server component — **23 Supabase round trips** — and re-signs **every** photo URL.
3. Because signed URLs carry a fresh `iat`/`exp` per call, every refresh changes every `<img src>`, so the browser **re-downloads every full-resolution original** in the grid. There are no thumbnails anywhere.
4. Finalize itself is heavy: **14–16 server→Supabase round trips per photo**, including a full download of the file into the function and (for HEIC / EXIF-rotated shots) a full re-upload.
5. Net: ~37–39 backend round trips and a full-grid image reload *per photo*. That is the "clunky and takes a while".
6. Transfer and finalize share one 3-slot client gate, so a photo holds a slot for `transfer + finalize`, roughly halving upload throughput.
7. `onProgress` writes the entire queue to `localStorage` via `JSON.stringify` on every tick — a synchronous main-thread stall several times a second during upload. This is the "not smooth".
8. Edit pipeline: correct and genuinely webhook-driven (no hard-rule violation), but three mounted components each poll `/reconcile` every 5s and `router.refresh()` unconditionally, so result pages re-render (and reload images) every 5 seconds regardless of change.
9. Real bugs found: dead `upload_items`/`upload_batches` realtime subscriptions; room-on-upload is dead code; abandoned reservations are never garbage-collected and show as "Uploading" forever; `/api/jobs` leaks an orphaned job on partial file-group insert failure.
10. Security is broadly sound (RLS `FOR ALL` policies do gate INSERT; webhook signature + replay window verified; service-role confined to server). Two soft spots: `createAdminClient()` used to sign storage URLs on the file-group page, and the legacy `/api/upload` route.

---

## 1. Upload pipeline call trace

### 1.1 Client → server / client → Supabase, per photo

N = files in one selection. Sizes assume a typical 6000×4000 JPEG ≈ 14 MB (fixture measured locally: 13.96 MB).

| # | Step | file:function | Calls per photo | Est. wall clock |
|---|------|---------------|-----------------|-----------------|
| 1 | Validate locally | `lib/upload-queue.ts:44 validateBrowserUpload` → `config/uploads.ts:55 validateUploadDeclaration` | 0 (local) | <1 ms |
| 2 | Batch reserve | `app/listings/[id]/upload-queue.tsx:549 reserveFiles` → `app/api/uploads/prepare/route.ts:16 POST` | **1/N** | 300–900 ms once for the whole selection (see 1.2) |
| 3 | Direct resumable transfer | `upload-queue.tsx:254 startTransfer` (tus) → `*.storage.supabase.co/storage/v1/upload/resumable` | **1 + ceil((size−6 MB)/6 MB)**; 14 MB ⇒ 3 HTTP requests (`TUS_CHUNK_SIZE = 6 MB`, `lib/upload-queue.ts:3`) | Bandwidth-bound. 14 MB @ 20 Mbps ≈ 6 s; @ 5 Mbps ≈ 22 s |
| 3a | Session lookup before each transfer | `upload-queue.tsx:240-243 supabase.auth.getSession()` | 1 (local, cached) | ~0 |
| 3b | Resume scan | `upload-queue.tsx:310 upload.findPreviousUploads()` | 0 (localStorage) | 1–5 ms |
| 4 | Finalize | `upload-queue.tsx:197 finalizeItem` → `app/api/uploads/[itemId]/finalize/route.ts:13 POST` | **1** | **2.5–7 s** (see 1.3) |
| 5 | Page refresh | `upload-queue.tsx:181 refreshPhotos` → `router.refresh()` (350 ms debounce) | **~1** | **0.8–2.5 s server + full grid image re-download** (see 1.4) |
| — | Recovery hydrate on mount | `upload-queue.tsx:379` → `app/api/uploads/route.ts:4 GET` | 1 per page load | 200–500 ms |

**Total app-server requests per photo: 2 (+1/N).** Matt's estimate of 3 is accurate. The count is not the problem.

### 1.2 `/api/uploads/prepare` — server → Supabase, per selection

| Call | Location | Count |
|---|---|---|
| middleware `auth.getUser()` | `middleware.ts:29` | 1 HTTP to GoTrue |
| route `auth.getUser()` | `prepare/route.ts:18` | 1 HTTP to GoTrue (duplicate of the above) |
| `listings` ownership select | `prepare/route.ts:46` | 1 |
| `rooms` validation select | `prepare/route.ts:55` | **0 — dead code, see F6** |
| `upload_batches` insert | `prepare/route.ts:100` | 1 |
| `upload_items` insert (batched) | `prepare/route.ts:108` | 1 |
| `createSignedUploadUrl` | `prepare/route.ts:117` | **N** (parallel `Promise.all`) |

`= 5 + N` round trips for the whole selection. This step is already well designed — one reservation for the batch, signed URLs generated in parallel.

### 1.3 `/api/uploads/[itemId]/finalize` — server → Supabase, per photo

| # | Call | file:line | Notes |
|---|---|---|---|
| 1 | middleware `auth.getUser()` | `middleware.ts:29` | HTTP to GoTrue |
| 2 | route `auth.getUser()` | `finalize/route.ts:19` | second HTTP to GoTrue, same request |
| 3 | `upload_items` select | `lib/intake-lifecycle.ts:18` | |
| 4 | `upload_batches` select | `lib/intake-lifecycle.ts:24` | sequential after 3; could be one join |
| 5 | `upload_items` claim update | `finalize/route.ts:43` | |
| 6 | `storage.info("intake")` | `lib/intake.ts:152` | |
| 7 | **`storage.download("intake")`** | `lib/intake.ts:163` | **full file into the function — 14 MB** |
| 8 | `storage.copy` intake→originals | `lib/intake.ts:117` | server-side, cheap |
| 9 | `storage.upload` canonical | `lib/intake.ts:135` | **only when HEIC or EXIF orientation > 1 — another full 14 MB up** |
| 10 | `rpc finalize_upload_item` | `finalize/route.ts:110` | atomic, correct |
| 11–12 | `getOwnedUploadItem` **again** | `finalize/route.ts:133` | 2 more selects; the only field used is `intake_deleted_at` |
| 13 | `storage.remove("intake")` | `lib/intake-lifecycle.ts:40` | |
| 14 | `upload_items` update (`intake_deleted_at`) | `lib/intake-lifecycle.ts:42` | |
| 15 | `upload_items` select by batch | `lib/intake-lifecycle.ts:79` | |
| 16 | `upload_batches` update | `lib/intake-lifecycle.ts:88` | last item of batch only |

**14 round trips minimum, 16 in the HEIC / rotated case.**

CPU, measured locally on this machine (Apple silicon; Vercel serverless is ~2–4× slower):

```
create 6000x4000 jpeg (fixture)              433 ms
fixture bytes: 13.96 MB
sharp().metadata()                           3 ms
sharp().metadata() again                     0 ms
sharp().rotate(90).toBuffer()                293 ms
```

So sharp is not the cost — the cost is I/O. Estimated finalize wall clock, Vercel↔Supabase same region:

- 4 auth/DB round trips before any work: ~150–300 ms
- download 14 MB into the function: **~1.2–3 s**
- `extractSourcePhotoMetadata` + 2× `sharp().metadata()` (`lib/intake.ts:193,207,215`): ~10–30 ms
- HEIC convert (`lib/intake.ts:200`): **+1.5–4 s** when applicable
- rotate + re-upload 14 MB (`lib/intake.ts:214,228`): **+1.5–3.5 s** when applicable
- copy + 6 trailing DB/storage calls: ~250–500 ms

**≈ 2.5–4 s for a straight JPEG, 6–11 s for HEIC or a portrait-orientation phone shot.** `maxDuration = 120` (`finalize/route.ts:11`) is sized for the worst case.

### 1.4 The hidden cost: `router.refresh()` per photo

`upload-queue.tsx:181-184` debounces 350 ms, then calls `router.refresh()`. With `MAX_CONCURRENT_UPLOADS = 3` finalizes land seconds apart, so almost every photo gets its own refresh. Each refresh re-executes `app/listings/[id]/page.tsx`:

| Wave | file:line | Queries |
|---|---|---|
| 1 | `page.tsx:25-66` `Promise.all` | 13 |
| 2 | `page.tsx:68` `loadListingStatuses` → `lib/listing-status-server.ts:19` | 6 |
| 3 | `page.tsx:71` `getUrls("originals", …)` | 1 |
| 4 | `page.tsx:114` `getUrls("outputs", …)` | 1 |
| 5 | `page.tsx:124` `output_versions` compliance re-fetch | 1 |
| 6 | `page.tsx:131` `getUrls("references", …)` | 1 |

**23 Supabase round trips in 6 sequential waves, ≈ 0.8–2.5 s server time.** Waves 2–6 are a waterfall that could collapse into wave 1.

Worse, wave 3 mints **new** signed URLs for every photo. A Supabase signed URL is a JWT whose `iat`/`exp` change per call, so `photo.url` differs on every refresh. `photo-grid.tsx:185` renders `<img src={photo.url}>` against the **full-resolution original** — no `transform`, no `next/image`, no derivative (grep for `transform:` in `lib/storage.ts` returns nothing). Result: **every finalize invalidates the browser cache for the entire grid and re-downloads every original.** At 30 photos × 14 MB that is ~420 MB re-fetched per refresh, ~30 times over one shoot.

### 1.5 Client-side stalls

- `upload-queue.tsx:275-283` — `onProgress` calls `updateItem`, which maps the whole array and calls `setItems`.
- `upload-queue.tsx:349-360` — an effect on `[items]` runs `JSON.stringify` over the whole queue and a **synchronous** `localStorage.setItem` on every one of those ticks. tus fires XHR progress events roughly 4–20×/s per upload; with 3 concurrent that is **12–60 synchronous serialise-and-write cycles per second**, over up to 100 items.
- `upload-queue.tsx:332-347` — the scheduler effect also depends on `items`, so it re-filters the whole queue on every progress tick.

This is the direct cause of "not slick, not smooth."

### 1.6 Can the call count be reduced? Yes — without touching any hard rule

Nothing here is constrained by CLAUDE.md. "Never await image generation in a request handler" is about fal, not intake; "originals immutable, versions additive" is preserved by the source/canonical split.

| Change | Saves | Risk |
|---|---|---|
| **Only refresh once per batch, not per photo.** Replace `refreshPhotos()` per finalize with a single refresh when the queue drains (or a `revalidateTag`-scoped refetch of just the photo list). | ~N−1 × 23 queries and ~N−1 full-grid image reloads. **Biggest single win.** | Low |
| **Serve thumbnails.** Add a `transform: { width, quality }` option to `lib/storage.ts:getUrls` and use it in `photo-grid.tsx:185` / `listing-workspace.tsx:471`. | 14 MB → ~60 KB per tile. | Low |
| **Stabilise signed URLs.** Round `expiresIn` to a bucket boundary or cache the signed URL per `(path, 15-min window)` so refreshes return byte-identical URLs and the browser cache holds. | Removes the reload-on-refresh entirely. | Low |
| **Drop the second `getUser()` in every route.** Middleware already validated the session (`middleware.ts:29`); routes can use `getClaims()`/`getSession()` instead of a second GoTrue HTTP call. Applies to every handler under `/api`. | 1 network round trip per API call, ×3 upload calls per photo. | Low — keep `getUser()` where the route is the only guard (`/api/webhook`, `/api/cron` are outside the matcher). |
| **Range-read instead of full download.** `lib/intake.ts:163` downloads the whole file only to sniff magic bytes, read EXIF and read dimensions — all of which live in the first ~256 KB. Fetch a `Range: bytes=0-262143` from a signed URL instead, and only pull full bytes when normalisation is actually needed. | ~1–3 s per photo on the common (JPEG, orientation 1) path. | Medium — sharp needs enough header bytes; needs a fallback to full download. |
| **Collapse `getOwnedUploadItem` to one join** (`lib/intake-lifecycle.ts:18-31`) and drop the redundant re-read at `finalize/route.ts:133`. | 3 round trips per photo. | Low |
| **Separate the transfer gate from the finalize gate** (`upload-queue.tsx:332-347`). Transfers are network-bound, finalizes are server-bound; sharing one 3-slot gate serialises them. | ~1.5–2× throughput. | Low |
| **Throttle the localStorage persist** to ~1 Hz / on status change only, and round `progress` to whole percent so most `onProgress` ticks are no-ops. | Removes the main-thread stall. | Low |
| **Deferred/queued canonicalisation.** Finalize could commit the photo row from the range-read header alone and let a background pass produce the canonical rotated/HEIC-converted object. | Moves 2–7 s off the user's critical path. | Medium — the grid must tolerate a not-yet-canonical photo. |

Not worth doing: batching finalize into one `POST /api/uploads/finalize` for N items. It saves ~N HTTP handshakes but serialises N × (download + convert) inside one function against `maxDuration`, and loses per-photo progress. Keep finalize per-photo; make it cheaper instead.

---

## 2. Edit pipeline trace

Composer → job creation → fal → webhook → result. **The hard rule is respected**: `app/api/jobs/route.ts` never awaits a generation; `submitStep` returns after the fal *queue submit*.

| Step | file:function | Cost |
|---|---|---|
| Compose | `app/listings/[id]/composer.tsx:335 run()` | Local. `pendingRequest.current` gives a stable idempotency key (`composer.tsx:358-361`) — good. |
| Interpret (optional) | `composer.tsx:431` → `/api/interpret` | 1 Claude call, blocking, no optimistic UI. |
| Create job | `composer.tsx:381` → `app/api/jobs/route.ts:17` | See below — this is the slow one. |
| Navigate | `composer.tsx:398-399` `router.push` + `router.refresh()` | Push then immediate refresh; the refresh re-fetches a page that is already mid-navigation. |
| Result page | `app/listings/[id]/f/[fileGroupId]/page.tsx:43` | ~9 round trips in 6 sequential waves. |
| Live updates | `file-group-workspace.tsx:226-237` realtime + `:271-285` 5 s poll | See F3. |
| Generation | `lib/orchestrator.ts:179 submitStep` → `lib/imaging.ts:74 submitGeneration` | Async, correct. |
| Completion | `app/api/webhook/fal/route.ts:8` → `lib/orchestrator.ts:242 completeStep` | Signature-verified (`lib/imaging.ts:158`, 300 s replay window), idempotent via conditional update (`orchestrator.ts:290-297`). Correct. |

### Latency and waterfall problems

**`/api/jobs` POST is serialised and slow for batches** (`app/api/jobs/route.ts`):
- Ownership + HDR + same-room validation: 5–6 queries (`:66`, `:78`, `:92`, `:104`).
- **`file_groups` are inserted one at a time in a loop** (`:371-392`), plus a separate `file_group_refs` insert per group (`:402`). For a 40-photo batch that is **80 sequential round trips**.
- `sample_images` use_count is a read-then-write loop (`:426-435`) — one UPDATE per sample, sequential.
- **`submitStep` is called sequentially for every file group** (`:446-448`). Groups 4…N exit early at the gate (`orchestrator.ts:188`) but still cost 2 queries each. Groups 1–3 each cost ~7 queries + a fal HTTP submit inside the request.

Estimated: **6–15 s** for a 40-photo batch before the composer's spinner clears. There is no optimistic UI — `running` (`composer.tsx:346`) just locks the dialog.

**Result page waterfall** (`f/[fileGroupId]/page.tsx`): `:51` → `Promise.all` `:63` → `:82` sibling photos → `:87` sign → `:89` sign **again for a path already signed at `:87`** → `:93` sign outputs → `:101` re-fetch `output_versions` columns that could have been in the `:66` join → `:115` `photo_finals`. **7 sequential waves.** `:89` and `:101` are pure redundancy.

**Polling vs realtime.** Realtime is wired (`file_groups`, `jobs`, `output_versions` are in `supabase_realtime`, migration `0002_phase3.sql:16`) *and* a 5 s poll runs on top of it in four places. The poll handler ignores the answer:

```ts
// file-group-workspace.tsx:277, job-feed.tsx:151, listing-progress.tsx:64
if (response.ok) router.refresh()
```

`/api/listings/[id]/reconcile` returns `{ checked, changed }` and `response.ok` is true even when `changed === 0`, so **the page fully re-renders every 5 seconds while any edit is running** — re-signing and re-downloading the before/after images each time. On `/listings/[id]` both `job-feed` and `listing-progress` poll independently, so it is **two `/reconcile` calls and two full refreshes every 5 s**, and `/reconcile` has **no age cutoff** (`reconcile/route.ts:45`, contrast the cron's 3-minute cutoff at `cron/reconcile/route.ts:20`) so it hits fal's status API for every running group on every tick.

One-line fix in three files: `if (data.changed > 0) router.refresh()`.

**Missing optimistic UI.** Every mutation is fetch → await → `router.refresh()` (62 `router.refresh()` call sites across 20 files). Nothing uses `useOptimistic` or a local state patch. Room tagging (`photo-grid.tsx:200`) at least uses `startTransition` + a server action with `revalidatePath`, which is better; the fetch-based paths are not.

---

## 3. Findings by severity

### High

**F1 — Every finalize triggers a 23-query page render and re-downloads every full-res original.**
`app/listings/[id]/upload-queue.tsx:181-184` → `app/listings/[id]/page.tsx:25-131`; images at `photo-grid.tsx:185`, `listing-workspace.tsx:405,471`. No thumbnail transform anywhere (`lib/storage.ts:31-58`). Signed URLs are unstable across calls, so `src` changes every refresh. Primary cause of the slow, heavy upload experience. Fix: refresh once per batch, add `transform` to `getUrls`, and cache signed URLs to a time bucket.

**F2 — Synchronous `localStorage` write of the whole queue on every tus progress event.**
`upload-queue.tsx:349-360` (effect on `[items]`), driven by `upload-queue.tsx:275-283`. 12–60 `JSON.stringify` + blocking `setItem` per second with 3 concurrent uploads. Direct cause of UI jank. Fix: throttle to ~1 Hz plus on status transitions; round `progress` before storing.

**F3 — `/reconcile` polled every 5 s by up to three mounted components, each unconditionally refreshing.**
`job-feed.tsx:139-157`, `listing-progress.tsx:58-75`, `file-group-workspace.tsx:271-285`; endpoint `app/api/listings/[id]/reconcile/route.ts:37-55` has no `step_started_at` cutoff. Wastes fal status calls, duplicates work already delivered by realtime, and re-renders (and reloads images on) the result page every 5 s. Fix: gate on `changed > 0`, hoist the poll to one owner per page, add the same 3-minute cutoff the cron uses.

**F4 — `finalize` downloads the entire file into the function to read a few header bytes.**
`lib/intake.ts:163` (`download`) feeding `sniffContentType` (`:80`), `extractSourcePhotoMetadata` (`:193`) and `sharp().metadata()` (`:207`). Adds ~1–3 s per photo. The rotate/HEIC branch (`:214`, `:228`) adds a second full transfer. Fix: range-read the first ~256 KB; fall back to a full read only when normalisation is required.

### Medium

**F5 — Abandoned upload reservations are never garbage-collected, and show as "Uploading" forever.**
Nothing expires `upload_items` in `status = 'reserved'`. `lib/listing-status.ts:118-131` turns every such row into a permanent `uploading` item in the progress panel; `app/api/uploads/route.ts:23-29` loads up to 50 `open` batches and *all* their items on every listing mount; the orphaned intake objects are never removed. `cron/reconcile` (`app/api/cron/reconcile/route.ts`) touches `file_groups` and `reels` only. Fix: expire reservations older than the 2 h signed-URL window in the cron, remove the intake object, mark the batch canceled.

**F6 — Room-on-upload is dead code.**
`lib/upload-queue.ts:44-51 validateBrowserUpload` never passes `roomId`, so `config/uploads.ts:85` always yields `null`, so `upload-queue.tsx:559` always sends `roomId: null`, so the ownership check at `app/api/uploads/prepare/route.ts:53-66` never executes and `upload_items.room_id` is always null. Either wire the room selector into the queue or delete the branch and the column plumbing.

**F7 — Dead realtime subscriptions on `upload_batches` / `upload_items`.**
`app/listings/[id]/listing-progress.tsx:46-47` subscribes to two tables that were never added to the `supabase_realtime` publication (compare `0002_phase3.sql:16`, `0010_shoot_organization.sql:102`, `0011_room_proposals.sql:125`, `0015`, `0017`, `0018` — `0009_reliable_intake.sql` adds none). The upload progress panel therefore never updates live; it only moves when something *else* triggers a refresh. Either publish the tables or drop the subscriptions.

**F8 — `/api/jobs` leaks an orphaned job when a file-group insert fails mid-loop.**
`app/api/jobs/route.ts:387-392` (and `:403-405`) return 500 after the `jobs` row at `:337` and any earlier `file_groups` are already committed. The job stays `status = 'processing'` forever; the cron only sweeps `running` groups. Fix: delete the job (cascade) before returning, or create the groups in one `insert([...])`.

**F9 — N+1 inserts and sequential submits in `/api/jobs`.**
`:371` one `file_groups` insert per photo, `:402` one `file_group_refs` insert per group, `:426-435` one `sample_images` update per sample, `:446-448` sequential `submitStep`. For a 40-photo batch this is ~80 round trips inside the user-facing POST. Fix: single batched insert for groups and refs, `Promise.all` over the first `MAX_CONCURRENT_RUNNING` submits and skip the rest (the cron's `kickQueued` already covers them).

**F10 — Transfer and finalize share one concurrency gate.**
`upload-queue.tsx:332-347` with `MAX_CONCURRENT_UPLOADS = 3` (`lib/upload-queue.ts:4`); `finalizeItem` holds the slot until `:217`. A photo occupies a slot for `transfer + finalize`, so network capacity idles while three finalizes run. Fix: separate counters (e.g. 4 transfers, 2 finalizes).

**F11 — Redundant `auth.getUser()` on every API request.**
`middleware.ts:29` already performs a GoTrue HTTP round trip for every matched path; each handler then does it again (`prepare/route.ts:18`, `finalize/route.ts:19`, `authorize/route.ts:11`, `cancel/route.ts:16`, `uploads/route.ts:5`, `jobs/route.ts:19`, `reconcile/route.ts:20`, and the rest). Two remote auth calls per request. Fix: use the local JWT claims in handlers already covered by the matcher.

**F12 — Redundant round trips in `finalize` and in the file-group page.**
`finalize/route.ts:133` re-reads the item via `getOwnedUploadItem` (2 queries) purely for `intake_deleted_at`; `lib/intake-lifecycle.ts:18-31` is two selects that should be one join. `f/[fileGroupId]/page.tsx:89` signs a path already signed at `:87`; `:101` re-fetches `output_versions` columns available in the `:66` join. Same pattern at `page.tsx:124`.

**F13 — Legacy `/api/upload` mutates originals and duplicates intake logic.**
`app/api/upload/route.ts` is still used by `app/listings/[id]/aerial/aerial-panel.tsx:24`. It (a) stores the EXIF-rotated bytes as the *only* copy (`:68-71`), losing the untouched original — the new intake path keeps `source` + `canonical`, this one does not, which is in tension with "Originals immutable / full-res originals preserved untouched"; (b) duplicates the HEIC/orientation logic of `lib/intake.ts:199-216`; (c) skips `MAX_UPLOAD_FILE_BYTES` and magic-byte sniffing, trusting client `file.type`; (d) derives the storage extension from the raw filename (`:51`) with no whitelist. Fix: move aerial onto the intake path and delete this route.

### Low

**F14 — `createAdminClient()` used to sign storage URLs on a user-facing page.**
`app/listings/[id]/f/[fileGroupId]/page.tsx:86-93`. Ownership *is* established first by the RLS-scoped reads at `:51` and `:66-74`, so this is not currently exploitable, but it removes storage RLS as a second line of defence on the signing call. Prefer the session client, as `app/listings/[id]/page.tsx:71` does.

**F15 — `MAX_CONCURRENT_RUNNING` is global, not per user.**
`lib/orchestrator.ts:56-64` counts every `running` file group in the database. Correct for one user; will silently throttle the second.

**F16 — Blocking sleeps inside request handlers.**
`lib/orchestrator.ts:508` (`handleGenerationError`) and `:228` (submit retry) `await setTimeout(1500)` while running under the fal webhook handler and the composer's `/api/jobs` POST.

**F17 — Webhook handler does substantial work inline.**
`app/api/webhook/fal/route.ts:36` → `completeStep` downloads the result, uploads it, runs a Claude vision QA call (`lib/orchestrator.ts:396` → `lib/qa.ts:80`), then submits the next chain step. Not a hard-rule violation (no generation is *awaited*), but the webhook can take many seconds; fal retries on timeout, and the conditional updates make that safe but wasteful.

**F18 — Dead 9-argument `finalize_upload_item` overload.**
`supabase/migrations/0009_reliable_intake.sql:102` is superseded by the 19-argument version in `0010_shoot_organization.sql:107`; `create or replace` with a new signature created a second function rather than replacing it. Revoked from `authenticated`/`public`, so harmless — but it is dead.

**F19 — `prepare` response order is assumed to match the request order.**
`upload-queue.tsx:565-578` pairs `prepared.items[index]` with `valid[index].file`. It holds today (`prepare/route.ts:115` uses `Promise.all` over an ordered map), but a mis-pair would upload the wrong bytes under the wrong reservation. Match on `name` + `size` instead.

**F20 — Oversized components.**
`composer.tsx` 993 lines with 20+ `useState`, `upload-queue.tsx` 938, `proofing-workspace.tsx` 815, `file-group-workspace.tsx` 688. The queue in particular mixes transfer scheduling, persistence, recovery and rendering; extracting a `useUploadQueue` hook would make F2 and F10 one-line fixes.

**F21 — Signed URLs expire in 1 h with no refresh path.**
`lib/storage.ts:34` default `expiresInSeconds = 3600`. A tab left open past an hour shows broken images until a refresh.

---

## 4. Recommended changes, prioritised

| # | Change | Files | Effort | Expected effect |
|---|---|---|---|---|
| 1 | Refresh once per batch, not per photo | `upload-queue.tsx:181-184` | **30 min** | Removes ~N−1 × 23 queries and ~N−1 full-grid image reloads. Largest single win. |
| 2 | Throttle the localStorage persist; round `progress` | `upload-queue.tsx:275-283,349-360` | **30 min** | Removes the main-thread stall — "smooth" |
| 3 | Gate poll refreshes on `changed > 0` | `job-feed.tsx:151`, `listing-progress.tsx:64`, `file-group-workspace.tsx:277` | **30 min** | Stops the 5 s whole-page re-render during edits |
| 4 | Thumbnail transform + stable signed URLs | `lib/storage.ts:31-58`, `photo-grid.tsx:185`, `listing-workspace.tsx:405,471` | **2–3 h** | 14 MB → ~60 KB per tile; browser cache actually holds |
| 5 | Range-read in `materializeIntakeItem` | `lib/intake.ts:152-234` | **3–4 h** | −1 to 3 s per photo on the common path |
| 6 | Split the transfer/finalize gates | `upload-queue.tsx:332-347`, `lib/upload-queue.ts:4` | **1 h** | ~1.5–2× upload throughput |
| 7 | Batch the `/api/jobs` inserts + parallel submits | `app/api/jobs/route.ts:371-407,446-448` | **2 h** | 6–15 s → ~1–2 s for a 40-photo batch |
| 8 | Add reservation GC to the cron; fix or drop the dead upload realtime subs | `app/api/cron/reconcile/route.ts`, `listing-progress.tsx:46-47`, a new migration | **2–3 h** | Fixes permanent phantom "Uploading" entries (F5, F7) |
| 9 | Collapse redundant round trips | `lib/intake-lifecycle.ts:18-31`, `finalize/route.ts:133`, `f/[fileGroupId]/page.tsx:87-101`, `page.tsx:68,124` | **2 h** | −3 per finalize, −2 per result page, −1 wave on the listing page |
| 10 | Drop the duplicate `getUser()` in matcher-covered routes | `middleware.ts` + every `/api` handler | **2 h** | −1 remote auth round trip per request |
| 11 | Fix the orphaned-job leak in `/api/jobs` | `app/api/jobs/route.ts:387-405` | **30 min** | Correctness |
| 12 | Move aerial onto the intake path; delete `/api/upload` | `aerial-panel.tsx:24`, `app/api/upload/route.ts` | **3–4 h** | Removes the last path that overwrites originals; deletes duplicated logic |
| 13 | Optimistic UI on the composer Run and on review actions | `composer.tsx:335-413`, `file-group-workspace.tsx:239-267` | **3–4 h** | Perceived latency, once 1–11 are done |
| 14 | Extract `useUploadQueue` from `upload-queue.tsx` | `app/listings/[id]/upload-queue.tsx` | **4–6 h** | Maintainability; makes 2 and 6 trivial |

Items 1–3 are roughly ninety minutes of work and address most of what Matt is feeling. Item 4 addresses the rest.

---

## 5. Hard-rule compliance

| Rule | Status |
|---|---|
| Never await generation in a request handler | **Pass** — `jobs/route.ts:446` submits to the fal queue only; webhook + cron advance the machine |
| Idempotent, signature-verified webhooks + reconciliation cron | **Pass** — `orchestrator.ts:290-297`, `imaging.ts:158-189` (300 s replay window), `vercel.json` `* * * * *` |
| Never self-host FLUX Kontext dev / FLUX.2 dev | **Pass** — all providers are fal-hosted (`config/models.ts`) |
| Geometry sentences verbatim | Not re-verified in this pass (`lib/prompts.ts` untouched) |
| Never infer floor plans from room photos | **Pass** — enforced at `jobs/route.ts:168-188` |
| Originals immutable, versions additive | **Pass on the intake path** (`intake.ts` source + canonical). **Deviation on `app/api/upload/route.ts:68-71`**, still reachable from the aerial tool — see F13 |
| Every API call hits SpendLedger exactly once | **Pass** — gated behind the conditional transition (`orchestrator.ts:290-322`); ideas counted once upfront (`jobs/route.ts:413-421`); QA counted separately (`orchestrator.ts:397-407`) |
| Keys in `.env.local`, never committed | **Pass** — no secrets in tracked files |
| All storage access via `lib/storage.ts` | **Pass**, with one deliberate exception: `createSignedUploadUrl` is called directly in `prepare/route.ts:117` and `authorize/route.ts:26` |
