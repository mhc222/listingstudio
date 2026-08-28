# PROGRESS.md

## Phases
- [x] Phase 1 — Scaffold + auth + schema + storage buckets
- [x] Phase 2 — Listings + photo upload + rooms + floor plans
- [x] Phase 3 — Imaging provider layer + orchestration + ITEM_REMOVAL end to end
- [x] Phase 4 — IMAGE_ENHANCEMENT + TURN_ON_LIGHTS + edit chaining
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
Phase 4 complete (code; manual test pending — needs fal spend). `lib/prompts.ts`: IMAGE_ENHANCEMENT (sky_replacement + day_sky_style presets any/clear_blue/clouds_blue/orange_sunrise + grass_repair) and TURN_ON_LIGHTS (no options) templates wired into compilePrompt; option compilation verified via tsx self-check. Job panel is now a chain builder: photo pick → add ordered edits (item removal / enhancement / lights) with per-edit option forms → optional comment + size preset → run. Jobs route stores size_preset. New `app/api/file-groups/[id]/download` returns the latest version with the group's size preset applied at download time via sharp descending-quality ladder (DECISIONS.md — presets never stored); Download link on each After image. Fixed chain bug found while exercising: `inputUrlForStep` computed the previous step's path from the group's current retry_count (per-group counter), so a retry on step N broke the chain — now lists `outputs/{fg}/` and takes the newest `step-{n-1}-r*` object (new `list` helper in lib/storage.ts). Build + lint + tsc clean.

Phase 4 manual test (Matt): enhance a dull exterior with clear-blue sky + grass repair; chain ITEM_REMOVAL → IMAGE_ENHANCEMENT on an interior and confirm two ledger rows + both step outputs in the outputs bucket; download an output with an under-5MB preset.

Phase 3 state (proven live 2026-08-28): Provider layer `lib/imaging.ts` (fal queue API via raw fetch: qwen default / gemini / kontext / local stub; ED25519 webhook signature verification against fal JWKS). State machine `lib/orchestrator.ts` — every transition a conditional update (claim queued→running, complete gated on fal_request_id+running, error requeue gated the same way), retry-once-with-backoff on submit AND one auto-retry on generation error (retry_count column), ledger row + increment_job_cost rpc only on the winning transition. Routes: `app/api/jobs` (create+submit), `app/api/file-groups/[id]/rerun`, `app/api/webhook/fal` (signature-verified), `app/api/cron/reconcile` (GET, CRON_SECRET bearer, rescues running >3 min; `?all=1` reconciles everything — this is the completion path in local dev since fal can't reach localhost). vercel.json cron every minute. Migration 0002 applied live (retry_count, last_error, numeric cost, rpc, realtime publication on jobs/file_groups/output_versions). Job UI on listing page: photo picker + tier + free text → run → live status via Realtime → before/after + re-run on failure. Build + lint clean.

Outstanding (Matt, manual):
- No auth user exists yet (auth.users count = 0). Supabase dashboard -> Authentication -> Add user (email + password).
- SUPABASE_SERVICE_ROLE_KEY blank in .env.local (dashboard Settings -> API) — REQUIRED for phase 3 job submission (orchestrator/webhook/cron use the admin client).
- FAL_KEY blank in .env.local (fal.ai dashboard) — REQUIRED to run a job.
- ~~Keys/auth user~~ DONE 2026-08-28: service role key + FAL_KEY in .env.local, auth user created, fal balance topped up.
- Phase 3 manual test PASSED 2026-08-28: ITEM_REMOVAL (full declutter) ran end to end — job complete, 1 output version, 1 ledger row (2.1¢, no double-charge despite a failed first attempt on exhausted fal balance), second reconcile pass a no-op (idempotency proven), reconcile-as-completion-path proven (localhost has no webhook). Found+fixed live: middleware was auth-gating /api/cron (commit 9abeee4).
- Webhook signature verification still unexercised locally (needs deployed URL — phase 16).

## Next action
Phase 5 — VIRTUAL_STAGING + sample library + context grounding (see PLAN.md).
