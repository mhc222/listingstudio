# PROGRESS.md

## Phases
- [x] Phase 1 — Scaffold + auth + schema + storage buckets
- [x] Phase 2 — Listings + photo upload + rooms + floor plans
- [x] Phase 3 — Imaging provider layer + orchestration + ITEM_REMOVAL end to end
- [x] Phase 4 — IMAGE_ENHANCEMENT + TURN_ON_LIGHTS + edit chaining
- [x] Phase 5 — VIRTUAL_STAGING + sample library + context grounding
- [ ] Phase 6 — RENOVATION + LANDSCAPING + DAY_TO_DUSK + presets + COLOUR_CHANGE + SHADOW_REMOVAL
- [ ] Phase 7 — Interpreter loop 1: intent parsing + prompt compilation + chat UI
- [ ] Phase 8 — Interpreter loop 2: conversational rework + branching + auto-QA
- [ ] Phase 9 — Inspiration: ideas grid + URL extraction + attachments + style memory
- [ ] Phase 10 — Batch mode + cost simulator + before/after polish + MLS presets
- [ ] Phase 11 — FLOOR_PLAN_REDRAW
- [ ] Phase 12 — VIRTUAL_TOUR builder
- [ ] Phase 13 — COPYWRITING
- [ ] Phase 14 — AERIAL annotation + PORTRAIT_RETOUCHING + HDR_MERGE
- [ ] Phase 15 — Dashboard + spend tracking
- [ ] Phase 16 — Vercel deploy
- [ ] Phase 17 — Experimental 360 edits

## Current state
Phase 5 complete (code; manual test pending — needs fal spend). `lib/prompts.ts`: VIRTUAL_STAGING template — 9 FURNITURE_STYLES (specific materials each), per-room-type furniture map, spatial anchoring sentence, FURNITURE_REQUIRED free text, ref-image-matching line, verbatim geometry + brightness cue + listing suffix; `Grounding` type threaded through compilePrompt into VIRTUAL_STAGING and ITEM_REMOVAL. Jobs route computes grounding at creation (primary photo's room dims → CLAUDE.md dimension sentence; first non-PDF floor plan auto-attached as photo ref for staging/renovation chains), stores `jobs.grounding_used`, validates sampleImageIds via RLS read, inserts `file_group_refs`. Orchestrator fetches grounding + signed ref URLs at submit; imaging passes `image_urls: [primary, ...refs]` to gemini; refs force the gemini provider (only multi-image fal endpoint — DECISIONS.md). Sample library: `app/api/samples` upload (heic-converted, references bucket, path `{user}/{id}`), `app/library` page (upload + grid), refs picker strip + staging option form (room type / style / required text) in the job panel, grounding line shown on job cards, library link on listings index. No migration needed (0001 already had sample_images / file_group_refs / grounding_used / references bucket). Build + lint + tsc clean; template + grounding compilation verified via tsx self-check.

Phase 4 manual test (Matt, still pending): enhance a dull exterior with clear-blue sky + grass repair; chain ITEM_REMOVAL → IMAGE_ENHANCEMENT on an interior and confirm two ledger rows + both step outputs in the outputs bucket; download an output with an under-5MB preset.

Phase 5 manual test (Matt): upload a style reference to the sample library; stage an empty living room (Farmhouse) tagged to a Room with dimensions, with the library ref attached — confirm the Grounding line on the job card shows the dimension sentence, provider is gemini, and grounding_used is on the job row; rerun for a bedroom with FURNITURE_REQUIRED text; if the listing has a floor plan, confirm "floor plan attached as reference" appears.

Phase 3 state (proven live 2026-08-28): Provider layer `lib/imaging.ts` (fal queue API via raw fetch: qwen default / gemini / kontext / local stub; ED25519 webhook signature verification against fal JWKS). State machine `lib/orchestrator.ts` — every transition a conditional update (claim queued→running, complete gated on fal_request_id+running, error requeue gated the same way), retry-once-with-backoff on submit AND one auto-retry on generation error (retry_count column), ledger row + increment_job_cost rpc only on the winning transition. Routes: `app/api/jobs` (create+submit), `app/api/file-groups/[id]/rerun`, `app/api/webhook/fal` (signature-verified), `app/api/cron/reconcile` (GET, CRON_SECRET bearer, rescues running >3 min; `?all=1` reconciles everything — this is the completion path in local dev since fal can't reach localhost). vercel.json cron every minute. Migration 0002 applied live (retry_count, last_error, numeric cost, rpc, realtime publication on jobs/file_groups/output_versions). Job UI on listing page: photo picker + tier + free text → run → live status via Realtime → before/after + re-run on failure. Build + lint clean.

Outstanding (Matt, manual):
- No auth user exists yet (auth.users count = 0). Supabase dashboard -> Authentication -> Add user (email + password).
- SUPABASE_SERVICE_ROLE_KEY blank in .env.local (dashboard Settings -> API) — REQUIRED for phase 3 job submission (orchestrator/webhook/cron use the admin client).
- FAL_KEY blank in .env.local (fal.ai dashboard) — REQUIRED to run a job.
- ~~Keys/auth user~~ DONE 2026-08-28: service role key + FAL_KEY in .env.local, auth user created, fal balance topped up.
- Phase 3 manual test PASSED 2026-08-28: ITEM_REMOVAL (full declutter) ran end to end — job complete, 1 output version, 1 ledger row (2.1¢, no double-charge despite a failed first attempt on exhausted fal balance), second reconcile pass a no-op (idempotency proven), reconcile-as-completion-path proven (localhost has no webhook). Found+fixed live: middleware was auth-gating /api/cron (commit 9abeee4).
- Webhook signature verification still unexercised locally (needs deployed URL — phase 16).

## Next action
Phase 6 — RENOVATION + LANDSCAPING + DAY_TO_DUSK + light presets + COLOUR_CHANGE + SHADOW_REMOVAL (see PLAN.md).
