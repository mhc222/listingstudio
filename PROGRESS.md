# PROGRESS.md

## Phases
- [x] Phase 1 — Scaffold + auth + schema + storage buckets
- [x] Phase 2 — Listings + photo upload + rooms + floor plans
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
Phase 2 complete. Listings CRUD (`app/listings/page.tsx`), listing detail with photo grid + room panel + floor plans (`app/listings/[id]/page.tsx`), batch upload route (`app/api/upload/route.ts`: heic-convert for HEIC → JPEG, sharp for dimensions, PDFs allowed as floor plans only), room CRUD via server actions, quick-tag at upload + per-photo re-tag. `npm run build` + `npm run lint` clean. Supabase project gczmpmjaqgtkxqdopknx (org zzbpawcjzxujqxustqup).

Outstanding (Matt, manual):
- No auth user exists yet (auth.users count = 0). Supabase dashboard -> Authentication -> Add user (email + password).
- SUPABASE_SERVICE_ROLE_KEY blank in .env.local — paste from dashboard Settings -> API when a phase needs it.
- Phase 2 manual test not yet run (needs the auth user above).

## Next action
Phase 3 — Imaging provider layer + orchestration + ITEM_REMOVAL end to end (see PLAN.md). Needs FAL_KEY in .env.local.
