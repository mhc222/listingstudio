# PROGRESS.md

## Phases
- [x] Phase 1 — Scaffold + auth + schema + storage buckets
- [x] Phase 2 — Listings + photo upload + rooms + floor plans
- [x] Phase 3 — Imaging provider layer + orchestration + ITEM_REMOVAL end to end
- [ ] Phase 4 — IMAGE_ENHANCEMENT + TURN_ON_LIGHTS + edit chaining
- [ ] Phase 5 — VIRTUAL_STAGING + sample library + context grounding
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
Phase 3 complete (code + migration; live run blocked on keys below). Provider layer `lib/imaging.ts` (fal queue API via raw fetch: qwen default / gemini / kontext / local stub; ED25519 webhook signature verification against fal JWKS). State machine `lib/orchestrator.ts` — every transition a conditional update (claim queued→running, complete gated on fal_request_id+running, error requeue gated the same way), retry-once-with-backoff on submit AND one auto-retry on generation error (retry_count column), ledger row + increment_job_cost rpc only on the winning transition. Routes: `app/api/jobs` (create+submit), `app/api/file-groups/[id]/rerun`, `app/api/webhook/fal` (signature-verified), `app/api/cron/reconcile` (GET, CRON_SECRET bearer, rescues running >3 min; `?all=1` reconciles everything — this is the completion path in local dev since fal can't reach localhost). vercel.json cron every minute. Migration 0002 applied live (retry_count, last_error, numeric cost, rpc, realtime publication on jobs/file_groups/output_versions). Job UI on listing page: photo picker + tier + free text → run → live status via Realtime → before/after + re-run on failure. Build + lint clean.

Outstanding (Matt, manual):
- No auth user exists yet (auth.users count = 0). Supabase dashboard -> Authentication -> Add user (email + password).
- SUPABASE_SERVICE_ROLE_KEY blank in .env.local (dashboard Settings -> API) — REQUIRED for phase 3 job submission (orchestrator/webhook/cron use the admin client).
- FAL_KEY blank in .env.local (fal.ai dashboard) — REQUIRED to run a job.
- Phase 2 + 3 manual tests not yet run (need the above).
- Phase 3 manual test: create listing → upload cluttered room photo → Jobs panel: pick photo, "Minor removal", describe items → Run. Locally, hit `curl "http://localhost:3000/api/cron/reconcile?all=1"` to poll completion (no webhook on localhost). Verify before/after appears, spend_ledger row exists, and re-running reconcile is a no-op (idempotency). Simulate a kill: while a step is running, wait 3+ min and let reconcile rescue it.

## Next action
Phase 4 — IMAGE_ENHANCEMENT + TURN_ON_LIGHTS + edit chaining (see PLAN.md).
