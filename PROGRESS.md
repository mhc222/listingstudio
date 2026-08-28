# PROGRESS.md

## Phases
- [x] Phase 1 — Scaffold + auth + schema + storage buckets
- [ ] Phase 2 — Listings + photo upload + rooms + floor plans
- [ ] Phase 3 — Imaging provider layer + orchestration + ITEM_REMOVAL end to end
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
Phase 1 complete. Supabase project "Listing Studio" (id gczmpmjaqgtkxqdopknx, org zzbpawcjzxujqxustqup — Matt created it in the dashboard, different org than DarylV3's). Migration 0001_init applied and verified: 10 tables, 3 buckets (originals/outputs/references), 10 RLS policies. .env.local written with URL + anon key. `npm run build` clean.

Outstanding (Matt, manual):
- No auth user exists yet (auth.users count = 0). Supabase dashboard -> Authentication -> Add user (email + password).
- SUPABASE_SERVICE_ROLE_KEY blank in .env.local — paste from dashboard Settings -> API when a phase needs it.

## Next action
Phase 2 — Listings + photo upload + rooms + floor plans (see PLAN.md).
