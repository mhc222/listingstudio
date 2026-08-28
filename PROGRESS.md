# PROGRESS.md

## Phases
- [ ] Phase 1 — Scaffold + auth + schema + storage buckets (code done; blocked on Supabase project creation — see Next action)
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
Phase 1 code complete and committed, `npm run build` clean:
- Next.js 15 scaffold (TS, Tailwind v4, App Router), shadcn/ui (button, input, card, label), lib/utils.ts, theme in app/globals.css
- supabase/migrations/0001_init.sql — full schema (all tables, enums, RLS, indexes) + 3 buckets (originals/outputs/references) + storage policies (originals immutable)
- lib/supabase/{client,server}.ts, lib/storage.ts (upload/getUrl/download wrapper)
- middleware.ts (auth gating, /login excepted, /api/webhook excluded for later fal signature auth)
- app/(auth)/login/page.tsx (email+password), app/auth/signout/route.ts, app/page.tsx dashboard shell
- .env.example written; .env.local NOT yet created

BLOCKED: no Supabase project for this app exists (org cqwwlkprrjxjlymlbhwx has datacolor-content-machine + DarylV3 only). New project = $10/month — awaiting Matt's confirmation.

## Next action
On Matt's approval of the $10/mo:
1. Supabase MCP: confirm_cost (project, monthly, 10) -> create_project name "listing-studio", region us-east-1, org cqwwlkprrjxjlymlbhwx -> poll get_project until ACTIVE_HEALTHY
2. apply_migration project_id=<new id>, name "init", query = contents of supabase/migrations/0001_init.sql
3. get_project_url + get_publishable_keys -> write .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
4. Create the single user: execute_sql cannot create auth users — Matt adds his user in Supabase dashboard (Authentication -> Add user, email+password), or use the admin API with service role key
5. Manual test: npm run dev, sign in, see dashboard shell, confirm 3 buckets in Supabase dashboard
6. Check Phase 1 off here, final commit "phase 1 complete: ..."
