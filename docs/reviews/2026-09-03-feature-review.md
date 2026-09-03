# Listing Studio — feature review, 2026-09-03

Read-only review of the deployed product at Phase 54 (application commit `efc3d1a`, live schema `0018`). No source file
was changed, no build was run, no generation was submitted. Sources: `CLAUDE.md`, `docs/claude-reference.md`, `PLAN.md`
(Phases 42–54 + finding coverage), `42-UX-BENCHMARK.md`, `IDEAS.md`, the top `ACTIVE HANDOFF` in `PROGRESS.md`, and
direct reading of `app/`, `components/`, `lib/`, `config/`, `scripts/`, `vercel.json`.

## Executive summary

1. The operational spine that Phase 42 said was missing is now built and genuinely mature: resumable intake, HDR/room
   organization, server-enforced batch scope, named presets, derived listing status, contact-sheet proofing, approved
   finals, streaming MLS delivery, version labels, scoped rework. 443 assertions across 12 test scripts back it.
2. The product is no longer missing workflow *stages*. It is slow because every stage is a separate, explicitly
   confirmed pass, and nothing composes them. A 40-photo shoot takes roughly 8 surfaces and ~50 discrete confirmations.
3. The worst single offender is proofing: `app/api/listings/[id]/proofing/route.ts` accepts exactly one photo per
   request. Forty photos means forty approvals. There is no bulk approve anywhere.
4. Second offender: there is no whole-shoot action. "Select all visible → Edit 40 → Enhance → Start" works
   (`listing-workspace.tsx:312`), but the two organization passes before it and the forty approvals after it are manual.
5. Real quality gap, and it is invisible in the UI: no `image_size` is sent for normal chains (`lib/imaging.ts`,
   `lib/orchestrator.ts:219` sets it for 360 only) and delivery uses `withoutEnlargement: true` (`lib/deliver.ts`).
   Delivered edits are the model's native output resolution, not the 24MP original. The `docs/claude-reference.md`
   claim of an "optional UPSCALE step, default ON for full-res final downloads" was never implemented.
6. `file-group-workspace.tsx:31` labels that download "Full-resolution edit". That label is wrong.
7. Per-photo cost/latency is driven by chain length: every step is a separate fal call. The most common real-world
   pair (enhance + lights) is two calls where one prompt would do.
8. `MAX_CONCURRENT_RUNNING = 3` (`lib/orchestrator.ts:56`) is a hardcoded global gate across all file_groups. It is the
   single largest wall-clock lever on a full shoot and is not configurable.
9. Genuine advantages over every benchmarked competitor: immutable version lineage, verbatim geometry constraints,
   auto-QA with one corrective retry, per-call spend truth, conversational interpretation, and a manifest-backed
   approved-finals package. Keep all of it.
10. Around a third of the edit catalog and three tool routes are carrying complexity no single user is paying for.

## Feature inventory

Maturity scale: **Mature** = complete, tested, exercised end to end. **Solid** = works, no dedicated tests, no known
gaps. **Thin** = reachable but under-finished, stale, or unused. **Claimed** = documented but not in the code.

### Intake and organization

| Feature | Maturity | Evidence |
|---|---|---|
| Resumable direct-to-storage intake (TUS, 6 MiB chunks, ≤3 concurrent, pause/cancel/retry/reload recovery) | Mature | `app/listings/[id]/upload-queue.tsx` (938 lines), `lib/intake.ts`, `lib/intake-lifecycle.ts`, `lib/upload-queue.ts`, `app/api/uploads/{prepare,[itemId]/{authorize,finalize,cancel}}/route.ts`, `scripts/test-intake-contract.mjs`, `scripts/test-upload-queue.mjs` |
| Published limits and preflight (50 MB/file, 100 files, jpg/png/webp/heic/heif, pdf for plans) | Mature | `config/uploads.ts` |
| Immutable source + explicit canonical normalized derivative (HEIC/EXIF rotation) | Mature | `lib/intake.ts`, `lib/storage.ts`, migration `0009_reliable_intake.sql` |
| Source identity preserved (original filename, capture time, intake order, exposure metadata) | Mature | `lib/photo-metadata.ts`, `lib/delivery.ts` (`originalFilename`, `intakeOrder`) |
| HDR bracket proposal, split/merge/reorder/confirm, immutable source exposures, one representative | Mature | `lib/hdr-groups.ts`, `app/listings/[id]/shoot-organization.tsx`, `app/api/listings/[id]/photo-groups/**`, `app/api/hdr-merge/route.ts`, `scripts/test-shoot-organization.mjs` |
| Room + same-view proposals with accept/correct/defer, confidence, evidence, ledgered analysis | Mature | `lib/room-analysis.ts`, `lib/room-analysis-images.ts`, `app/listings/[id]/room-organization.tsx`, `app/api/listings/[id]/room-analysis/**`, `scripts/test-room-analysis.mjs` |
| Room browser + tray filtering (Suggested/Confirmed/Needs review/Untagged) | Mature | `app/listings/[id]/room-browser.tsx`, `app/listings/[id]/photo-grid.tsx` |
| Floor-plan attachment + printed-dimension extraction (Sonnet vision, never inferred from photos) | Solid | `app/listings/[id]/extract-rooms.tsx`, `app/api/listings/[id]/extract-rooms/route.ts`, `lib/prompts.ts:621` (`FLOOR_PLAN_PARSE_SYSTEM`), `config/models.ts` (`VISION_PARSE_MODEL`) |
| Reconcilable counts (source photos / logical photos / plans / stacks / merged) | Mature | `app/listings/[id]/shoot-organization.tsx:118-127`, `app/dashboard/page.tsx:35-70` |

### Studio and edit execution

| Feature | Maturity | Evidence |
|---|---|---|
| One composer for single photo and batch; task rail + "More" popover; scope summary; generation estimate | Mature | `app/listings/[id]/composer.tsx` (993 lines), `app/listings/[id]/chain-step-editor.tsx`, `lib/simulate.ts` |
| Server-enforced batch scope (immutable snapshot, per-target overrides, mixed-room Stage rejection) | Mature | `lib/batch-scope.ts`, `app/api/jobs/route.ts:70-200`, `scripts/test-batch-scope.mjs` |
| Selection: select-all-visible, Shift-range, touch range mode, room-group and same-room-group | Mature | `app/listings/[id]/listing-workspace.tsx:173-200, 305-350` |
| Named account presets (chain + options + size), listing/room defaults, one-time localStorage import | Mature | `lib/edit-presets.ts`, `app/listings/[id]/preset-controls.tsx`, `app/api/edit-presets/**`, `scripts/test-edit-presets.mjs` |
| Apply-last-chain accelerator | Solid | `app/listings/[id]/listing-workspace.tsx:160-170` |
| Orchestration: fal queue + signed webhook, conditional-update idempotency, per-minute reconcile cron | Mature | `lib/orchestrator.ts`, `lib/imaging.ts` (ED25519/JWKS verify), `app/api/webhook/fal/route.ts`, `app/api/cron/reconcile/route.ts`, `vercel.json` |
| Provider routing + provider-aware prompt dialects (qwen / gemini / kontext / local stub) | Mature | `config/models.ts:22` (`pickProvider`), `lib/prompts.ts:846` (`compilePrompt`), `scripts/check-dialects.ts` |
| Auto-QA: Claude vision pass on every final version, one corrective retry, never blocks | Mature | `lib/qa.ts`, `lib/orchestrator.ts:364-462` |
| SpendLedger, once per call including retries and QA | Mature | `lib/orchestrator.ts:299-321, 397-407`, `increment_job_cost` RPC |
| Context grounding (room dimensions, floor-plan reference) recorded on the job | Solid | `lib/orchestrator.ts:126-145`, `app/api/jobs/route.ts` (`grounding_used`) |
| Interpreter: plain language → editable chain / one clarifying question / 4 ideas | Solid | `lib/interpreter.ts`, `app/api/interpret/route.ts`, `lib/prompts.ts:720` |
| Conversational refinement → immutable new version, branch from any version | Mature | `app/api/file-groups/[id]/rework/route.ts`, `lib/versioning.ts`, `app/listings/[id]/f/[fileGroupId]/file-group-workspace.tsx` |
| Output resolution control / upscale | **Claimed, not built** | `docs/claude-reference.md` promises Real-ESRGAN default ON; no `image_size` for non-360 chains (`lib/orchestrator.ts:219` is the only setter); `lib/deliver.ts` uses `withoutEnlargement: true`; no `upscale`/`esrgan` reference anywhere in `lib/`, `app/`, `config/` |

### Edit types

| Edit type | Maturity | Evidence |
|---|---|---|
| IMAGE_ENHANCEMENT (+4 style presets, sky replacement, grass repair) | Mature | `lib/prompts.ts:124-183` |
| TURN_ON_LIGHTS (fixture-physics clause, no invented fixtures) | Mature | `lib/prompts.ts:185-203` |
| ITEM_REMOVAL (tier 1/2) | Mature | `lib/prompts.ts:41` |
| VIRTUAL_STAGING (9 room types, 9 styles, furnishing level, showcase, refs, curated real-photo previews) | Mature | `lib/prompts.ts:249-391`, `public/staging-styles`, `app/listings/[id]/chain-step-editor.tsx:202` |
| DAY_TO_DUSK + interior relight presets | Mature | `lib/prompts.ts:441-476`, `DUSK_QA_CHECKS` at `:652` |
| VIRTUAL_RENOVATION (light/mid/full) | Solid | `lib/prompts.ts:392-419` |
| VIRTUAL_LANDSCAPING | Solid | `lib/prompts.ts:420-440` |
| COLOUR_CHANGE | Solid | `lib/prompts.ts:477-494` |
| SHADOW_REMOVAL | Solid | `lib/prompts.ts:495-509` |
| FLOOR_PLAN_REDRAW (4 styles, SVG/PNG/PDF export) | Solid | `lib/prompts.ts:510-567`, `app/listings/[id]/plan/plan-panel.tsx`, `app/api/file-groups/[id]/plan-export/route.ts`, `lib/plan.ts` |
| MARKUP_EDIT (draw on the photo; gemini-only) | Solid | `components/markup-canvas.tsx`, `app/api/markup/route.ts`, `lib/prompts.ts:81`, `scripts/test-markup-e2e.mjs` |
| AERIAL_EDITING + Konva annotator | Thin | `app/listings/[id]/aerial/aerial-panel.tsx` (59 lines, pre-Phase-38 styling, still posts to the legacy `/api/upload` — the only remaining caller), `components/aerial-annotator.tsx` |
| PORTRAIT_RETOUCHING | Thin | `lib/prompts.ts:236` (no options at all), QA skipped (`lib/orchestrator.ts:374`) |
| 360_IMAGE_ENHANCEMENT / 360_ITEM_REMOVAL / 360_VIRTUAL_STAGING | Thin | Only reachable via the "More" popover (`composer.tsx:132-152`); no pano-specific intake; lanczos resize back to source dims, not a real upscale (`lib/orchestrator.ts:41-49`); QA skipped; output ships with a manual seam-review note |

### Proofing, delivery, downstream

| Feature | Maturity | Evidence |
|---|---|---|
| Derived listing status (Uploading/Organizing/Queued/Editing/Review pending/Needs attention) with drill-through | Mature | `lib/listing-status.ts`, `lib/listing-status-server.ts`, `app/listings/[id]/listing-progress.tsx`, `scripts/test-listing-status.mjs` |
| Contact-sheet proofing: filmstrip, filters, keyboard traversal, before/after, version pick, approve / needs-changes | Mature | `app/listings/[id]/proofing/proofing-workspace.tsx` (815 lines), `lib/proofing.ts`, `lib/proofing-server.ts`, `scripts/test-proofing.mjs` |
| Approved finals: one active final per logical source, original approvable, atomic replace, lineage-validated | Mature | `app/api/listings/[id]/proofing/route.ts` → `set_photo_review` RPC, migration `0015` |
| **Bulk approve** | **Absent** | `app/api/listings/[id]/proofing/route.ts` takes one `sourcePhotoId` per POST; no bulk handler and no bulk UI in `proofing-workspace.tsx` |
| Delivery profiles (format, dimensions, quality, byte ceiling, disclosure mode, naming, ordering) | Mature | `lib/delivery.ts`, `app/api/delivery-profiles/**`, `app/listings/[id]/delivery/delivery-workspace.tsx` |
| Package preview with fingerprint, included/omitted, warnings acknowledgement, missing-final block | Mature | `lib/delivery-server.ts`, `app/api/listings/[id]/delivery/route.ts` |
| Streaming approved-finals ZIP + manifest + disclosure companions | Mature | `lib/stream-zip.ts`, `app/api/listings/[id]/download-all/route.ts`, `lib/deliver.ts`, `scripts/test-delivery.mjs` |
| Version labels, parent/branch lineage, two-version compare, named variations (2–4) | Mature | `lib/versioning.ts`, `app/api/output-versions/[versionId]/{route,variations}.ts`, `scripts/test-versioning.mjs` |
| Scoped conversational batch rework (2–100 targets, exceptions, idempotency snapshot) | Mature | `lib/scoped-rework.ts`, `app/api/listings/[id]/batch-rework/route.ts`, `scripts/test-scoped-rework.mjs` |
| MLS compliance checker (vision checks + staged-label check, flags only) | Solid | `lib/prompts.ts:658-719`, `lib/qa.ts`, `scripts/check-compliance.ts` |
| Virtually-Staged watermark + filename suffix + companion disclosure | Solid | `lib/deliver.ts` |
| Mobile + state hardening (offline/reconnect, signed-URL retry, destination-preserving auth, drafts) | Mature | `lib/workflow-recovery.ts`, `components/workflow-connectivity.tsx`, `scripts/test-mobile-workflow.mjs` |
| Dashboard: recent listings, status rollup, MTD spend, BoxBrownie comparison | Solid | `app/dashboard/page.tsx`, `app/dashboard/dashboard-live.tsx`, `config/models.ts:33` (`BOXBROWNIE_CENTS`) |
| COPYWRITING (headline / 100w / 250w, per-tone upsert, ≤8 photos) | Solid | `app/api/listings/[id]/copy/route.ts`, `app/listings/[id]/copy/copy-panel.tsx`, `lib/prompts.ts:753-800` |
| VIRTUAL_TOUR (Marzipano, hotspots, share slug, public route) | Thin | `app/listings/[id]/tour/tour-panel.tsx`, `components/tour-viewer.tsx`, `app/tour/[slug]/page.tsx`; no tests; requires 360 panos the shoot does not produce |
| Listing reels (Ken Burns, ffmpeg, 9:16 / 16:9, caption overlay) | Thin | `lib/reel.ts`, `app/listings/[id]/reel/reel-panel.tsx`, `app/api/reels/route.ts`; **`assets/music/` contains only `README.md`, so the music picker is empty in production** |
| Ideas grid (4 diverse variants, one ledger entry) | Thin | `composer.tsx:459-482`, `app/api/jobs/route.ts:52-62`; one-photo-only, QA skipped, no promote-to-current affordance found |
| Sample library + style memory (`use_count`) | Thin | `app/library/page.tsx` (49 lines: no delete, rename, category, or room filter; pre-Phase-38 styling), `app/api/samples/**`, `composer.tsx:901-915` |
| URL inspiration extraction | Thin | `app/api/extract-images/route.ts`, `composer.tsx:740-760` |
| Terms of Use gate | Mature | `components/terms-gate.tsx`, `app/api/terms/accept/route.ts`, `config/terms.ts` |

## Gaps vs competitors

Measured against `42-UX-BENCHMARK.md`'s set (BoxBrownie, Autoenhance.ai, ApplyDesign, Virtual Staging AI,
REimagineHome; plus Lightroom, Frame.io, Canva, Photoroom).

### What Phase 43–54 actually closed

Every P0 and P1 in the benchmark's ranked-gap table is now implemented in code, and most with dedicated tests: reliable
intake (43/44), source identity + HDR + counts (45), room/same-view organization (46), safe batch scope (47), named
persistent presets (48), listing-level progress truth (49), contact-sheet proofing (50), MLS delivery profiles (51).
P2s too: version naming/compare (52), scoped rework (53), mobile/recovery (54). This review found no evidence that any
of those closures is superficial.

### What a working photographer still expects and does not get

1. **A one-action shoot.** Autoenhance's model is: add folder → name the order → pick grouping → Enhance. Four actions,
   independent of N, and organization happens inside processing. Listing Studio requires an upload pass, a "Find HDR
   brackets" pass, a "Run organization" + "Accept suggestions" pass, a selection pass, a composer pass, then N approval
   passes. Every one of those gates exists for a good reason logged in `DECISIONS.md`; the problem is that none of them
   can be *pre-authorized* as a single "do the usual thing to this shoot" instruction.
2. **Bulk approval.** Frame.io-style review always has multi-select approve. `app/api/listings/[id]/proofing/route.ts`
   is strictly one photo per call. On a 40-photo shoot this is the largest single click cost in the product.
3. **Full-resolution output.** BoxBrownie returns human edits at original resolution; Autoenhance exports to 6K.
   Listing Studio delivers the generative model's native output — no `image_size` request, no upscale, and delivery
   explicitly refuses to enlarge (`lib/deliver.ts`). MLS portals are forgiving; agent print pieces are not. This is the
   most commercially significant gap in the product and it is currently mislabelled as "Full-resolution edit"
   (`file-group-workspace.tsx:31`).
4. **A client/agent entity.** BoxBrownie and Autoenhance both key presets, defaults, and delivery on a client. Here,
   presets are account- or listing-scoped (`lib/edit-presets.ts`) and delivery profiles are account-scoped
   (`lib/delivery.ts`). There is no "this agent always wants warm + under 5MB + sequence naming".
5. **A share link.** Delivery is a ZIP download only (`app/api/listings/[id]/download-all/route.ts`). Every competitor
   hands the agent a URL. `app/tour/[slug]` proves the public-route pattern already exists in the codebase.
6. **Folder / cloud-drive import.** Autoenhance takes folders and Dropbox; Frame.io takes folder structures. The queue
   takes a multi-file chooser only. Deliberate, but it is the remaining intake friction on a card dump.
7. **Same-room furniture consistency.** ApplyDesign's promise. Listing Studio has the *primitive* (durable same-room
   groups, `lib/batch-scope.ts`, `app/api/listings/[id]/same-room-groups/**`) and honestly declines the promise. The
   cheap honest version — shared reference image and shared style forced across a same-room group in one submission —
   is not wired.
8. **Batch conversational input.** The composer's chat is hard-limited to one photo (`composer.tsx:338`,
   placeholder at `:717`). Scoped batch rework (Phase 53) covers corrections *after* results exist, but there is no way
   to say "all six exteriors, dusk, warm" as one instruction up front.

### What Listing Studio has that none of them do

- **Immutable version lineage with named branches and DB-enforced cross-listing rejection** (`lib/versioning.ts`,
  migration `0017`). Photoroom explicitly discards batch history; the others do not expose branch semantics.
- **Verbatim geometry constraints in every generative template** (`lib/prompts.ts:5-8`, applied in every builder). This
  is the anti-hallucination moat and no competitor documents an equivalent.
- **Auto-QA with one corrective retry and a stored verdict** (`lib/qa.ts`, `lib/orchestrator.ts:437-462`). Nobody else
  audits their own output before showing it.
- **Per-call spend truth** including retries and QA (`spend_ledger`), with a BoxBrownie comparison line.
- **Provider-aware prompt dialects** (`lib/prompts.ts:829-857`) — the same intent compiled differently for qwen,
  gemini, and kontext.
- **Approved-finals package with a full manifest** recording source, chosen version, transformation, disclosure,
  dimensions, and bytes (`app/api/listings/[id]/download-all/route.ts:32-70`). Stronger than Autoenhance's export.
- **Chained sequential generative edits** as a first-class concept. Autoenhance stacks parameters; this stacks
  operations.
- **Markup-to-edit** (`components/markup-canvas.tsx`) — draw on the photo, the drawing drives the edit. No benchmarked
  competitor has it.
- **Compliance flagging built into the QA pass** rather than bolted on.

## Per-photo processing model assessment

### How it actually works today

`app/api/jobs/route.ts` creates one FileGroup per photo and submits step 0. `lib/orchestrator.ts` then runs a per-group
state machine: submit → webhook/reconcile → store output → ledger row → advance to step *n+1* → repeat → on the final
step insert one `output_versions` row → run auto-QA → optionally append one corrective REWORK step. So per photo:

- **fal calls = chain length**, plus 1 if auto-QA fails and produces a corrective instruction.
- **Claude calls = 1** (auto-QA), unless the chain is FLOOR_PLAN_REDRAW / PORTRAIT_RETOUCHING / 360 / ideas / variation
  (`lib/orchestrator.ts:373-378`).
- **Intermediate steps produce no version row** — a two-step chain is inspectable only as its final image.
- Throughput is capped by `MAX_CONCURRENT_RUNNING = 3` (`lib/orchestrator.ts:56`), a *global* gate across every
  file_group in the system, enforced best-effort by `runningCount` + `kickQueued`.

A 40-photo enhance-plus-lights shoot is therefore 80 fal generations and 40 QA calls, three generations in flight at a
time. On production, webhooks advance each step immediately; in local dev there is no webhook (`webhookUrl()` refuses
localhost) so each step waits for the next minute-boundary cron, making the same shoot take hours locally. That
dev/production asymmetry is worth stating explicitly since it distorts any local perception of "slow".

### Where the time and money actually go

| Lever | Effect on a 40-photo shoot | Constraint check |
|---|---|---|
| Merge enhance + lights into one prompt (an option on `IMAGE_ENHANCEMENT`, not a second chain step) | 80 → 40 generations; halves both cost and wall clock for the commonest combo | Clean. Geometry sentence stays verbatim (both templates already append `GEOMETRY_INTERIOR`); fewer calls means fewer ledger rows, each still exactly once. `TURN_ON_LIGHTS`'s fixture-physics clause is self-contained prose and composes into `IMAGE_ENHANCEMENT`'s `parts` array without paraphrase. |
| Raise / configure the concurrency gate | 3 → 8 concurrent cuts queue-drain wall clock ~2.6× | Clean. The gate protects fal rate limits, not correctness — the comment at `lib/orchestrator.ts:53-57` says so. Move the constant to `config/models.ts` and tune it. Cheapest large win in the product. |
| Skip auto-QA on high-confidence enhance-only chains | Removes 40 Claude calls and their latency | Allowed but **not recommended as a default**. QA is a differentiator and it is cheap (Haiku-tier, `config/models.ts:53`). Better: keep QA, run it *out of band* so a Ready result is visible before its verdict lands. |
| Batch the QA pass (one Claude call reviewing several results) | Fewer round trips | Rejected. It muddies per-photo verdicts and the ledger's one-row-per-call clarity. Not worth it. |
| Request a larger `image_size` from the provider | Fixes the resolution gap at source | Provider-dependent and costs more per call. Worth measuring before adding an upscale stage. |
| Add a real upscale stage (Real-ESRGAN via fal) | Fixes resolution; adds one call and one ledger row per photo | Clean under the rules (fal-hosted, no FLUX dev weights, ledgered once). This is the promise in `docs/claude-reference.md` that was never kept. |

### Should there be a one-click whole-shoot enhance?

Yes — and the pieces already exist. What is missing is composition, not capability.

The blocker is a *policy*, not an architecture: Phase 48's locked boundary says "No preset silently starts processing"
and Phase 47's says "Nothing selected never means all". Both are correct as written and both are satisfied by a single
explicit shoot-level confirmation. The right shape:

**One "Process shoot" action on the listing** that shows exactly one confirmation screen — N logical photos, M pending
bracket proposals it will confirm at high confidence, the room proposals it will accept at high confidence, the preset
chain it will apply, the exact generation count and cost, and the list of photos it will *skip* because they need human
judgement — then runs the whole thing in the background and reports a summary. Scope stays visible and explicit; the
operator confirms once instead of eight times. That respects both locked boundaries literally.

Smarter defaults that cost nothing:
- Preselect the listing-default preset in that confirmation instead of "Choose after selecting photos"
  (`upload-panel.tsx:47`).
- Auto-apply confirmed room settings per target rather than surfacing "Use each photo's confirmed room settings" as an
  error recovery (`composer.tsx:627`). The mechanism (`withConfirmedRoomStaging`) already exists and is correct — it
  should be the default path, not the remedy.
- Auto-run bracket detection on intake completion (it is already deterministic metadata work — `lib/hdr-groups.ts` —
  and *proposals* commit nothing).

Background processing with a summary is already how the system behaves; what is missing is a place that says "shoot
done: 38 ready, 1 needs attention, 1 flagged by QA" as the arrival surface. `lib/listing-status.ts` computes exactly
that today — it just is not the thing Matt lands on.

Provider strategy: leave it. `pickProvider` (`config/models.ts:22`) routes on chain length and reference presence,
which is the right axis, and Phase 24's dialect compilation is a real asset. The one improvement worth considering is
routing *by edit type* — staging benefits from gemini's multi-reference capability far more than an enhance pass does —
but that needs Matt's eyes on paired outputs before changing proven defaults.

## Candidates to cut or hide

For one power user, these are carrying complexity nobody is paying for. "Hide" means keep the code and drop it out of
the primary surfaces; "cut" means delete.

| Item | Recommendation | Why |
|---|---|---|
| Three 360 edit variants | **Hide** behind an explicit "Experimental" section, or cut | Reachable only through the "More" popover, QA-skipped, lanczos-resized, output ships needing manual seam review. `lib/orchestrator.ts:39-50` is the most caveated code in the repo. It exists to feed tours the shoot does not produce. |
| VIRTUAL_TOUR (Marzipano) | **Hide** the tool route until 360 capture is real | 391 + 144 lines and a public route, gated on equirectangular panos. `IDEAS.md` already identifies Gaussian splatting as the credible path — this is the wrong implementation waiting for the right input. |
| Listing reels | **Fix or hide** | `assets/music/` holds only a README, so the music picker is empty in production. Either drop two tracks in and keep it, or hide it. Shipping a feature whose picker is empty is worse than not shipping it. |
| PORTRAIT_RETOUCHING | **Cut from the composer** | Zero options (`lib/prompts.ts:236`), QA-skipped, and headshots are not part of a listing shoot. |
| Ideas grid | **Hide** | One-photo-only, QA-skipped, four generations per use, and no promote-to-version affordance found. Named variations (Phase 52) subsume it with better lineage and explicit cost. |
| URL inspiration extraction | **Hide** into the reference picker | A whole route (`app/api/extract-images/route.ts`) plus five state variables in the composer for a paste-a-Pinterest-link path that a screenshot upload covers. |
| Sample library page | **Fold into the reference picker** | `app/library/page.tsx` is 49 lines, pre-Phase-38 styling, no delete/rename/category. It is a standalone page for something only ever used from inside the composer. |
| Aerial route | **Fold into the studio, or finish it** | `aerial-panel.tsx` is pre-Phase-38 styling and is the last caller of the legacy `/api/upload` route. Phase 44 said that route survives only for "proven remaining small internal callers" — this is the one keeping it alive. Migrating it lets `/api/upload` be deleted. |
| Nine-item "More" popover | **Trim to five** | `composer.tsx:132-152` renders every non-primary edit type — including three experimental 360 variants and portrait retouching — as an undifferentiated flat list. |
| Tools subnav | **Trim from nine tabs** | `tools-nav.tsx` lists Photos / Aerial / Reel / Tour / Plan / Copy / Proofing / Delivery / Activity. Four of those are the daily workflow. Aerial, Reel, Tour, and Copy are occasional; they belong behind one "More tools" entry. |
| `docs/claude-reference.md` upscale claim | **Correct it** | It documents a default-ON upscale step that does not exist. Either build it (recommended) or delete the sentence — a permanent-memory doc that overstates the product is a live hazard for future sessions. |

Explicitly **keep**, despite low apparent use: markup-to-edit (unique and cheap), floor-plan redraw (real BoxBrownie
substitute at $20/plan avoided), copywriting (cheap, self-contained, high perceived value), compliance checking (rides
the QA call at no extra cost), style memory (`use_count` is 3 lines of code).

## Proposed roadmap — Phases 55–58

Ordered by value to the daily workflow. Each is one phase under the existing execution protocol.

### Phase 55 — The one-action shoot

Compose the eight existing passes into one confirmed instruction. Add a single **Process shoot** action on the listing
that opens one confirmation screen and nothing else: exact logical photo count, the bracket proposals it will confirm
at high confidence, the room proposals it will accept at high confidence, the preset chain and output size, the exact
generation count and cost from `lib/simulate.ts`, and an explicit list of photos it will *skip* and why (untagged and
needing a room for a Stage step, low-confidence bracket, ambiguous room). One confirm, then it runs behind the existing
orchestrator with the existing concurrency gate and the operator lands on `lib/listing-status.ts`'s aggregate as the
arrival surface. Make the listing-default preset preselected, make `withConfirmedRoomStaging` the default path instead
of an error remedy, and run bracket detection automatically when an intake batch finalizes (proposals commit nothing,
so this violates no boundary). This honours both locked boundaries — scope is fully visible and explicitly confirmed —
while collapsing the ceremony from eight decisions to one. Nothing new in the data model; this is composition of Phases
43–51 plus one route and one screen.

### Phase 56 — Bulk approval and delivery resolution

Two independent fixes to the two remaining hard costs, both in the back half of the workflow. First, bulk approve:
extend `app/api/listings/[id]/proofing/route.ts` to accept an explicit ordered list of `{sourcePhotoId, outputVersionId}`
pairs under one idempotency key, applied through the same `set_photo_review` RPC per target so every existing lineage
and atomicity invariant holds, and add **Approve all shown** to `proofing-workspace.tsx` scoped to the active filter
with the exact count in the label. Same rule as everywhere else: the visible filter is the scope, empty never means
all. Second, resolution: measure what the providers actually return, then either request a larger `image_size` at
submit or add a fal-hosted Real-ESRGAN stage as an explicit final chain step — ledgered once, idempotent, behind the
same state machine, no self-hosted weights. Fix the "Full-resolution edit" label in `file-group-workspace.tsx:31` to
state actual pixel dimensions, surface those dimensions in the proofing panel, and correct the upscale claim in
`docs/claude-reference.md`. Together these remove ~40 clicks and close the one gap where a competitor's output is
objectively better than ours.

### Phase 57 — Throughput and one-call chains

Make the same work finish sooner and cost less, with no change to what the operator decides. Move
`MAX_CONCURRENT_RUNNING` out of `lib/orchestrator.ts:56` into `config/models.ts` and raise it after measuring fal's
actual concurrency headroom — the gate protects rate limits, not correctness, so this is a config change with a real
multiplier on wall clock. Add a `lights_on` option to `IMAGE_ENHANCEMENT` that appends `TURN_ON_LIGHTS`'s existing
fixture-physics clauses verbatim into the same prompt, so the commonest real-world pair is one generation instead of
two: half the cost, half the latency, one ledger row per call as always, and the geometry sentence untouched. Keep
`TURN_ON_LIGHTS` as a standalone edit for photos that need only relighting. Then move auto-QA off the critical path —
mark the version Ready when the image lands and let the QA verdict and its one corrective retry arrive as an update, so
proofing can start on a shoot whose QA is still finishing. Verify with the existing suites plus a `check-dialects`
extension covering the merged template; no migration required.

### Phase 58 — Client profiles and delivery links

Add the one entity the product is missing and the one delivery surface every competitor has. A lightweight client
record (name, brokerage, contact, notes) owned by the account, optionally attached to a listing, carrying a default
preset and a default delivery profile so "this agent always wants warm, under 5MB, sequence-named" resolves
automatically into Phase 55's confirmation screen — extending the existing `resolvePresetDefault` precedence chain in
`lib/edit-presets.ts` rather than inventing a second one. Then a read-only delivery share link for an approved package,
built on the same slug-and-public-route pattern already proven by `app/tour/[slug]/page.tsx`: it recomputes the
approved set server-side at open time exactly as the ZIP route does, shows the finals with the profile applied, offers
the ZIP, and can be revoked. No team roles, no comments, no permissions matrix — a single-user product with one
outward-facing URL. This is also the natural foundation for the agent-branding arc already spec'd in `IDEAS.md`, which
should stay in `IDEAS.md` until the daily workflow is genuinely fast.

**Explicitly not proposed:** RAW ingest, cloud-drive import, native apps, Gaussian-splat tours, the furniture
warehouse, or the marketing suite. All are defensible someday; none of them makes next Tuesday's shoot faster.
