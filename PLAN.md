# PLAN.md — Listing Studio build phases

One phase per session. Each phase: goal, files, definition of done (DoD), manual test.
Conventions used throughout: all prompt templates in `lib/prompts.ts`; provider calls only through `lib/imaging.ts`; storage only through `lib/storage.ts`; per-model rates in `config/models.ts` (data, not code).

---

## Phase 1 — Scaffold + auth + schema + storage buckets

**Goal:** Running Next.js 15 app with Supabase auth (single user) and the full database schema, so no later phase touches migrations for core entities.

**Files:** `create-next-app` scaffold (TS, Tailwind, App Router), shadcn/ui init, `supabase/migrations/0001_init.sql`, `lib/supabase/{client,server}.ts`, `lib/storage.ts` (thin wrapper: upload/getUrl/download over Supabase Storage), `app/(auth)/login/page.tsx`, middleware for auth gating, `.env.example`.

**Schema (multi-user-ready: user_id on root tables, no team UI):**
- `listings` (id, user_id, address, mls_number, created_at)
- `rooms` (id, listing_id, name, room_type enum, length, width, ceiling_height, units ft|m, notes)
- `photos` (id, listing_id, room_id nullable, storage_path, width, height, is_floor_plan bool, created_at)
- `jobs` (id, listing_id, title, status pending|processing|complete|failed, submitted_at, completed_at, total_cost_cents, grounding_used jsonb, kind normal|ideas)
- `file_groups` (id, job_id, primary_photo_id, edit_chain jsonb ordered [{edit_type, options}], comment, size_preset, provider, state machine fields: current_step, step_status, fal_request_id, step_started_at)
- `file_group_refs` (file_group_id, photo_id | sample_image_id)
- `output_versions` (id, file_group_id, version_number, parent_version_id nullable for branching, storage_path, qa_note, created_at)
- `sample_images` (id, user_id, storage_path, label, use_count int for style memory)
- `chat_messages` (id, file_group_id, role, content, created_at)
- `spend_ledger` (id, job_id, file_group_id, edit_type, model, cost_cents, kind generation|rework|qa|upscale|ideas|interpreter, created_at)
- Buckets: `originals` (no overwrite policy), `outputs` (versioned paths), `references`.

**DoD:** `npm run build` clean; migration applied; login works; RLS on all tables (user_id = auth.uid()).
**Manual test:** Sign in, see empty dashboard shell, confirm buckets exist in Supabase dashboard.

---

## Phase 2 — Listings + photo upload + rooms + floor plans

**Goal:** Full listing management: create listing, batch-upload photos (jpg/png/webp/heic with server-side heic convert via sharp), tag photos to rooms, enter room dimensions, attach floor plans.

**Files:** `app/listings/page.tsx` (list + create), `app/listings/[id]/page.tsx` (photo grid, room panel), `app/api/upload/route.ts` (sharp heic convert, dimension extraction, originals bucket), room CRUD components, floor-plan attach flow (upload image/PDF, `is_floor_plan` flag).

**DoD:** Build clean; batch upload of 10+ photos works incl. one .heic; quick-tag during upload and later; untagged photos fine.
**Manual test:** Create a listing, upload mixed-format photos, tag three to a Room with dimensions, attach a floor plan.

---

## Phase 3 — Imaging provider layer + orchestration + ITEM_REMOVAL end to end

**Goal:** The load-bearing phase. `lib/imaging.ts` provider interface (qwen default, gemini, kontext, local stub), fal queue submission, webhook state machine, reconciliation cron, spend ledger, versioning — proven with ITEM_REMOVAL as the first working edit.

**Files:** `lib/imaging.ts`, `config/models.ts` (per-model rates), `lib/prompts.ts` (ITEM_REMOVAL tier 1/2 templates), `app/api/webhook/fal/route.ts` (signature verification, idempotent conditional-update transitions), `app/api/jobs/route.ts` (create job + file groups, submit first step), `lib/orchestrator.ts` (advance state machine: next chain step / complete / fail; ledger writes), `vercel.json` or `vercel.ts` cron -> `app/api/cron/reconcile/route.ts` (poll fal by request_id for steps running >3 min), minimal job UI on listing page (select photo -> ITEM_REMOVAL tier + free text -> run -> live status via Supabase Realtime -> output version appears).

**DoD (non-negotiable hardening included):** duplicate webhook delivery is a no-op (conditional update proven); signature verified; reconcile cron completes a manually-orphaned step; retry-once-with-backoff on API failure with re-run button and no double-charged ledger; build clean.
**Manual test:** Run ITEM_REMOVAL on a cluttered room photo, watch status advance live, see before/after versions, check ledger row, kill a webhook (simulate) and watch the cron rescue it.

---

## Phase 4 — IMAGE_ENHANCEMENT + TURN_ON_LIGHTS + edit chaining

**Goal:** The every-photo edit with sky/grass options, lights edit, and multi-edit chains (output of step N = input of step N+1) through the same state machine.

**Files:** `lib/prompts.ts` (IMAGE_ENHANCEMENT with SKY_REPLACEMENT + DAY_SKY_STYLE presets + GRASS_REPAIR toggle; TURN_ON_LIGHTS), chain support in orchestrator (already modeled in phase 3; exercised with 2-step chains here), edit-picker UI with option toggles, MLS size preset application via sharp on final outputs.

**DoD:** A FileGroup with [ITEM_REMOVAL, IMAGE_ENHANCEMENT] chain runs both steps sequentially and ledger shows two calls; sky/grass options alter the compiled prompt; build clean.
**Manual test:** Enhance a dull exterior with clear-blue sky + grass repair; chain remove-then-enhance on an interior; verify both steps' outputs stored as the chain progresses.

---

## Phase 5 — VIRTUAL_STAGING + sample library + context grounding

**Goal:** Staging with ROOM_TYPE + 9 FURNITURE_STYLE presets, FURNITURE_REQUIRED free text, reference images, account-level sample library, and automatic room-dimension/floor-plan grounding.

**Files:** `lib/prompts.ts` (staging template: verbatim geometry sentence, spatial anchoring, brightness cue, listing suffix), staging option UI (room type + style pickers, furniture free text, ref image attach), `app/library/page.tsx` + attach-from-library flow, grounding injection in prompt compiler (dimensions as text, floor plan as extra ref image; record on job.grounding_used).

**DoD:** Staging an empty room tagged to a Room with dimensions injects the dimension sentence (visible in job record); floor-plan-attached listing adds plan as ref; sample library images reusable across jobs; build clean.
**Manual test:** Stage an empty living room (Farmhouse) with a library reference; confirm grounding recorded; rerun for a bedroom with FURNITURE_REQUIRED text.

---

## Phase 6 — RENOVATION + LANDSCAPING + DAY_TO_DUSK + light presets + COLOUR_CHANGE + SHADOW_REMOVAL

**Goal:** Complete tier-1 catalog.

**Files:** `lib/prompts.ts` additions: VIRTUAL_RENOVATION (light/mid/full tiers), VIRTUAL_LANDSCAPING (verbatim landscaping geometry sentence), DAY_TO_DUSK + interior light presets (bright daylight, golden hour, soft overcast), COLOUR_CHANGE (single named element), SHADOW_REMOVAL. Edit-picker entries + per-edit option forms. DAY_TO_DUSK review UI shows the two named QA checks as manual checklist items (auto-QA arrives phase 8).

**DoD:** Every tier-1 edit runnable end to end; dusk output page displays the two named checks; build clean.
**Manual test:** Dusk-convert a front exterior and eyeball both checks; recolor a front door; renovate a kitchen (mid tier) with described finishes.

---

## Phase 7 — Interpreter loop part 1: intent parsing + prompt compilation + chat UI

**Goal:** Natural language in, structured job out. Chat thread per FileGroup with chips (edit type, room type, style) merging with typed text into one job spec.

**Files:** `lib/interpreter.ts` (Claude Haiku-tier call, strict JSON schema validated against edit catalog; one-clarifying-question rule; defaults noted on job record), interpreter system prompt in `lib/prompts.ts`, chat panel component (thread, chips, text box), job creation via chat path, dashboard job cards showing latest user message as description, interpreter calls in spend ledger (kind=interpreter).

**DoD:** "this empty living room needs to feel warm modern farmhouse and it's way too dark" compiles to [IMAGE_ENHANCEMENT, VIRTUAL_STAGING] with room/style options and the sentence preserved as comment; invalid model output rejected + retried; genuinely ambiguous room type asks exactly one question; build clean.
**Manual test:** Type three varied plain-English requests, inspect compiled specs on the job records, run one.

---

## Phase 8 — Interpreter loop part 2: conversational rework + branching + auto-QA

**Goal:** React in chat -> corrective rework -> new version. Version tree with branching. Auto-QA vision pass before display.

**Files:** rework flow in `lib/interpreter.ts` (reaction + current version -> corrective prompt), version history UI (list + branch-from-any-version), `lib/qa.ts` (Claude vision pass: request-vs-result, geometry drift, DAY_TO_DUSK named checks; one auto-retry with corrective instruction, cap enforced as state transitions; QA note stored on version and shown), QA + retry rows in ledger.

**DoD:** "couch in gray, lose the wall art" produces version 2 preserving conversation context; branching from version 1 works; forced QA failure triggers exactly one retry then shows best attempt with visible note; build clean.
**Manual test:** Stage a room, issue two chat corrections, branch from v1, verify version tree and ledger.

---

## Phase 9 — Inspiration: ideas grid + URL extraction + chat attachments + style memory

**Goal:** Exploration features on top of the loop.

**Files:** ideas-grid flow (Interpreter picks 4 diverse directions; 4 parallel state machines; one "ideas" ledger job; labeled 2x2 grid; tap-to-promote into refinement chat), `app/api/extract-images/route.ts` (fetch single user URL, og:image + min-size img tags, picker strip, save picks to refs + sample library, graceful failure message), paperclip attach on chat box (upload or library pick), style-memory chips (use_count increment, suggest frequent refs on new jobs for the listing).

**DoD:** "show me some ideas" on an empty room renders 4 labeled diverse variants; promoting one drops into normal chat; pasting a Zillow URL yields a picker strip; failure path shows the screenshot-instead message; build clean.
**Manual test:** Run an ideas grid, promote a variant, refine it once; paste one good URL and one JS-walled URL.

---

## Phase 10 — Batch mode + cost simulator + before/after polish + MLS presets

**Goal:** Bulk workflows and pre-run cost transparency.

**Files:** batch UI (select N photos -> one edit stack + preset -> queue, concurrency gate 3, per-image progress), `lib/simulate.ts` (dry-run: chain length x per-model rate from config/models.ts, x2.5 average generations assumption, shown before run), before/after slider component on every output version, download menu (original / full-res edited / web-res 1920 / MLS under-10MB / under-5MB via sharp; "Virtually Staged" watermark toggle, default ON for staging+renovation), per-listing download-all-finals zip.

**DoD:** 6-photo batch runs max 3 concurrent; simulator estimate within model-rate math; watermark + filename suffix applied when toggled; zip contains latest final of each FileGroup; build clean.
**Manual test:** Batch-enhance 6 photos, watch the gate, download a staged photo with disclosure watermark, grab the zip.

---

## Phase 11 — FLOOR_PLAN_REDRAW

**Goal:** Sketch/plan image in -> clean labeled plan out. 2D templates first, then 3D variant.

**Files:** `lib/prompts.ts` (2D B&W, 2D Full Colour, 2D Colour Textured templates; 3D isometric re-render prompt applied to finished 2D plan, per storey), redraw UI (options: units, furniture y/n, north arrow, address label, disclaimer text), SVG+PNG+PDF export (sharp/pdf-lib), outputs attach to listing as floor plans (feeding phase 5 grounding). Never infer plans from room photos — input must be a plan/sketch.

**DoD:** All three 2D presets + 3D variant run; exports in all three formats; produced plan appears as listing floor plan and grounds a subsequent staging job; build clean.
**Manual test:** Redraw a hand sketch in 2D Full Colour with dimensions + disclaimer, then generate the 3D variant.

---

## Phase 12 — VIRTUAL_TOUR builder

**Goal:** 360 panos -> hosted Marzipano walkthrough.

**Files:** tour builder UI (upload equirectangular panos, order scenes, place hotspots, room labels), Marzipano viewer page, public share URL (`app/tour/[slug]/page.tsx`, unauthenticated), embeddable iframe snippet with copy button.

**DoD:** 3-scene tour with hotspot navigation works logged out via share URL; iframe snippet renders; build clean.
**Manual test:** Build a 3-room tour, open share link in incognito, embed snippet in a scratch HTML file.

---

## Phase 13 — COPYWRITING

**Goal:** Listing photos + facts -> MLS-ready copy.

**Files:** `app/listings/[id]/copy/page.tsx` (select photos, beds/baths/sqft/features form, tone picker: luxury/family/investor), Claude API call (prompt in `lib/prompts.ts`), outputs: headline + 100-word + 250-word, editable in-app with copy buttons, persisted per listing, ledger rows.

**DoD:** Copy generates from 4 photos + facts in each tone; edits persist; build clean.
**Manual test:** Generate luxury-tone copy for a staged listing, edit the headline, copy the 250-word block.

---

## Phase 14 — AERIAL annotation + PORTRAIT_RETOUCHING + HDR_MERGE

**Goal:** Specialty tools.

**Files:** Konva canvas tool (LOT_HIGHLIGHT single/multi semi-transparent fill, DROP_PIN markers, boundary lines, flattened PNG export — manual drawing, no AI), AERIAL_EDITING prompt variant (drone-tuned enhancement/sky), PORTRAIT_RETOUCHING template (conservative, identity preserved exactly), HDR_MERGE (3-9 brackets per FileGroup, sharp/enfuse-style exposure fusion in code, optional chain to IMAGE_ENHANCEMENT).

**DoD:** Annotated aerial exports flattened PNG; portrait pass is visibly conservative; 3-bracket merge produces balanced exposure then chains to enhancement; build clean.
**Manual test:** Highlight a lot + drop a pin on a drone shot and export; merge a bracket set.

---

## Phase 15 — Dashboard + spend tracking

**Goal:** The home screen earns its place.

**Files:** `app/page.tsx` dashboard: recent listings, jobs in progress (live), failed jobs with re-run, month-to-date spend broken down by edit type (ledger aggregation), per-listing BoxBrownie comparison ("this listing: $1.40 vs ~$220 at BoxBrownie" from config-stored BB prices).

**DoD:** All four dashboard sections live-update; spend math reconciles with ledger; build clean.
**Manual test:** Run a job and watch it move through in-progress to done; check MTD spend by edit type.

---

## Phase 16 — Vercel deploy

**Goal:** Production deployment.

**Files:** `vercel.ts`/config (cron registered), env vars via `vercel env`, Supabase prod config check (RLS, bucket policies, webhook URL pointed at prod), README deploy notes.

**DoD:** Production URL serves the app; a real job runs end to end in prod (webhook + cron verified in prod); no keys committed.
**Manual test:** Log in on prod from a phone, run an enhancement, download the result.

---

## Phase 17 — Experimental 360 edits

**Goal:** 360_IMAGE_ENHANCEMENT, 360_ITEM_REMOVAL, 360_VIRTUAL_STAGING at full equirectangular resolution, flagged experimental in UI, outputs marked for manual seam/pole review.

**Files:** 360 edit templates + full-res pipeline path (skip 1MP downscale), experimental badge + seam/pole review flag on outputs, optionally viewable in Marzipano from phase 12.

**DoD:** Each 360 edit runs on an equirectangular input and returns full-res output with review flag; build clean.
**Manual test:** Enhance a 360 pano, load result in the tour viewer, inspect seam and poles.

---

## Phase 18 — Darkroom visual identity

**Goal:** Apply the chosen "Darkroom" identity system to the app. Spec is the published artifact https://claude.ai/code/artifact/c59ca593-118c-4584-9364-a80994a20b62 (re-read it via the Artifact tool at phase start — the local source file is gone); decisions summarized in project memory `listing-studio-brand`. Ride-along: enhancement style presets (from the restudio.ai competitor analysis, DECISIONS.md 2026-08-29) — four named looks for IMAGE_ENHANCEMENT (Bright & Airy / Warm / Natural / Crisp) as prompt variants in prompts.ts plus a preset chip row on the job panel; user comments still append, geometry sentence verbatim, default = Natural.

**Files:** `app/globals.css` (drop-in tokens from the spec: cyan-biased greys ~hue 220, signal teal `#3FBFB9` dark mode / `#147F7A` light mode — teal means *the system is acting*, never decorative; separate state colours for queued/running/complete/failed/QA; radius 0.625→0.375rem). `app/layout.tsx` (next/font: JetBrains Mono + Public Sans; semantic split — mono = machine truth: state, cost, dimensions, filenames; sans = human intent). `public/`: three hand-tuned mark SVGs (104/40/16px — at 16px stroke doubles and the inner room goes solid fill; never one scaled file) + favicon. Header wordmark (JetBrains Mono Bold uppercase .2em, LISTING full weight / STUDIO regular secondary grey). Restyle state pills + file-group progress stripe. LAST (touches shipped output): watermark mark in `lib/deliver.ts`; `lib/plan.ts` address/disclaimer bands stay pure black on white, never teal (plans get printed and photocopied).

**DoD:** Tokens, fonts, mark, and state styling applied across dashboard/listings/job cards; both light and dark modes pass contrast (light-mode teal is `#147F7A`); watermark + plan band pixel-checked; style presets selectable on an IMAGE_ENHANCEMENT job and recorded on the job record; build clean.
**Manual test:** Eyeball dashboard, a listing page, and running job cards in light and dark; download a staged photo (new watermark pill); export a plan PNG (bands still plain black on white); run the same photo through two different style presets and confirm visibly different looks.

---

## Phase 19 — Listing video reels

**Goal:** AutoReel-style listing videos from finished photos (see DECISIONS.md 2026-08-29 + memory `listing-video-reels-idea`).

**Files:** Tier A first: photos → ~3s Ken Burns clips (pan/zoom over the *edited* outputs), crossfades, bundled royalty-free music picker, address/beds/baths caption overlay from listing facts, 9:16 and 16:9 MP4 exports. ffmpeg (or Remotion) — pure code, no ledger row (HDR_MERGE precedent). Render is a background job, NEVER in a request handler (CLAUDE.md orchestration rule); video lands in the outputs bucket with a download link on the listing. Reel builder panel on the listing page: photo multi-select + order, format toggle, music pick. Tier B (optional, ships only if Tier A motion feels flat): per-photo fal image-to-video (Kling ~$0.11/s / Veo 3.1 Fast ~$0.10/s → ~$0.30–0.35 per clip) through the existing queue/webhook state machine, ledgered like any generation; geometry-safe camera prompts only (slow push-in — no "walkthrough" prompts, walls bend).

**DoD:** Tier A reel generates end to end from a listing's photos in both formats and downloads; render survives a dev-server restart (state in DB, not memory); build clean. Tier B explicitly deferrable.
**Manual test:** Pick 8 finished photos on a listing, generate a 9:16 reel with music, play it, download it; regenerate in 16:9.

---

## Phase 20 — Terms of Use acceptance modal

**Goal:** Blocking Terms of Use dialog on first login (and again whenever the terms version bumps), matching the reference screenshot Matt supplied: centred dark modal, title + "Please review and accept our terms to start using [product]. Also available anytime at /terms.", scrollable terms body, "Decline & sign out" / "I Agree" footer buttons. Nothing in the app is usable until accepted.

**Source text:** `docs/terms-of-use.md` (verbatim as supplied). Written for **ReStudio.ai** with **Dubai/UAE** governing law — swap operator name, jurisdiction, and the `restudio.ai/terms` URL for Listing Studio's before this ships. Not reviewed by counsel; Matt's call whether it needs to be.

**Files:** `app/terms/page.tsx` (standalone always-available terms page rendering the markdown), a `<TermsGate>` client component in the root layout (shadcn Dialog, non-dismissable — no outside-click, no Esc, no X), migration adding `accepted_terms_version` + `accepted_terms_at` to the profile/user row, a `TERMS_VERSION` constant in config (bump = re-prompt everyone), a POST route recording acceptance, and "Decline & sign out" wired to Supabase sign-out.

**DoD:** Fresh account sees the modal before any page content and cannot dismiss it by any means; I Agree writes version + timestamp and never shows again; bumping `TERMS_VERSION` re-prompts; Decline signs out; `/terms` readable while signed out; build clean.
**Manual test:** Sign in with a fresh user — modal blocks, Esc/outside-click do nothing, accept, reload (no modal); bump the version constant, reload (modal returns); decline and confirm sign-out; open `/terms` in a logged-out window.

---

## Phase 21 — MLS compliance checker (candidate, from 2026-08-30 market analysis)

**Goal:** Extend the existing auto-QA vision pass into a named per-output compliance check, surfaced as a checklist on the output review UI. Idea from the market landscape review (DECISIONS.md 2026-08-30): compliance/QC automation is the least-crowded differentiator among AI-native competitors, and we already own the vision-pass plumbing.

**Checks (vision pass + metadata, one ledgered QA-style call):** (a) staged/renovated output carries the "Virtually Staged" watermark when the toggle is ON and the edit chain includes VIRTUAL_STAGING or VIRTUAL_RENOVATION (metadata check, free); (b) no fabricated permanent features vs the original — geometry sentence violations, added/removed windows or built-ins (vision); (c) DAY_TO_DUSK's two named checks fold in here unchanged; (d) result flagged, never blocked — a compliance note on the OutputVersion, same pattern as the existing QA note.

**Files:** prompts.ts (compliance prompt variant of the QA prompt), the QA step in the state machine gains a compliance mode for staging/renovation/dusk chains, OutputVersion gains a compliance jsonb note, review UI renders the checklist. Ledgered like any QA call, never double-counted.

**DoD:** Staged output shows a pass/fail compliance checklist; watermark-off staging flags; reworks re-run the check; build clean.
**Manual test:** Stage a photo with watermark ON (all green), re-download with watermark OFF (flag appears), run a DAY_TO_DUSK and confirm its two checks render in the same checklist.

---

## Phase 22 — Qwen negative prompts (prompt-moat hardening, small)

**Goal:** Send targeted `negative_prompt` values on every qwen generation — the cheapest win from the 2026-08-30 prompting-guide audit (DECISIONS.md). fal's qwen-image-edit accepts negative_prompt; gemini/kontext don't, so it's provider-gated.

**Files:** `lib/prompts.ts` — `NEGATIVES` map (3–6 terms per edit type targeting its known failure mode; DAY_TO_DUSK special-cased per preset since the interior relights *want* daylight) + `compileNegative(step)` export (resolves 360 wrappers, appends pano failure terms). `lib/orchestrator.ts` — submit path builds `extra.negative_prompt` when provider is qwen; single call site covers chains, reworks, and QA retries.

**DoD:** compileNegative returns the right string for a flat edit, a 360 edit, and both DAY_TO_DUSK branches; qwen submits carry negative_prompt (visible in fal request logs); typecheck clean.
**Manual test:** Run an IMAGE_ENHANCEMENT job on qwen and confirm in the fal dashboard request log that negative_prompt arrived; run a VIRTUAL_STAGING and eyeball for the usual warped-wall failure.

---

## Phase 23 — Markup-to-edit (candidate)

**Goal:** Click/drag/circle annotation on the primary photo drives the edit ("remove the item circled in blue, replace the item in the red rectangle with a leather recliner"). Externally validated: Google shipped this exact interaction ("draw-to-edit") in the Gemini app Dec 2025 on the same model family. Full shape in DECISIONS.md 2026-08-30.

**Gate:** ONE live experiment first (~$0.06): send a marked-up photo to qwen and gemini with a markup-instruction prompt; verify marks don't leak into output. If qwen leaks, markup jobs force gemini (marks ride the PRIMARY, so the ref-aspect bug doesn't apply).

**Files:** Reuse the phase-14 Konva annotation canvas on the FileGroup composer (new mark tools: circle = remove, rectangle = replace, color-keyed); flatten annotated PNG as the model input, clean original stays the stored source; interpreter maps marks to instruction clauses; prompt clause ends "Do not render any of the markings in the output."

**DoD:** Annotated job runs end to end, output has the edit and no visible marks, original photo untouched in storage; build clean.
**Manual test:** Circle a lamp in blue + rectangle a sofa in red, type "blue = remove, red = swap for a recliner", run, inspect output.

---

## Phase 24 — Provider-aware prompt compilation (the moat move)

**Goal:** compilePrompt renders the same semantic job spec in each provider's native dialect (2026-08-30 audit, finding 4): qwen = terse imperatives + negatives; gemini = natural-language scene description using Google's own template shape ("change only X… keep everything else exactly the same, preserving the original style, lighting, and composition"); kontext = direct naming, no pronouns, "while maintaining the same…" clauses. Ride-alongs from the same audit: interpreter emits an imperative-normalized comment (`comment_imperative`) used in compilation while the user's verbatim words stay on the record; preservation-first ordering A/B on qwen (geometry sentence as sentence 2) measured before adoption; LISTING_SUFFIX kept unless the A/B says otherwise (CLAUDE.md rule 4 stands until measured).

**Files:** `lib/prompts.ts` (compilePrompt gains a provider param; per-provider template renderers share the option/slot logic), `lib/orchestrator.ts` (passes fg.provider), `lib/interpreter.ts` + INTERPRETER_SYSTEM (comment_imperative field), jobs route stores both comment fields.

**DoD:** Same job spec produces three distinct provider-shaped prompts (unit-checkable string assertions); geometry sentences still verbatim in all three; interpreter round-trips comment_imperative; build clean.
**Manual test:** Run one staging job on qwen and one with a ref (gemini) and compare the logged prompts; type a vague comment ("cozy vibes") and confirm the compiled prompt carries an imperative version while the job card still shows the user's words.
