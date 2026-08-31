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

---

# UI REDESIGN ARC (phases 25–31, locked 2026-08-31)

Spec of record: DECISIONS.md 2026-08-31 "UI REDESIGN DIRECTION LOCKED" (commit b4c740d). Visual reference: mockup artifact https://claude.ai/code/artifact/c302dc51-2259-486c-8e4c-b17a52e3870f. Full working plan with settled design calls: ~/.claude/plans/wise-herding-aho.md. No migrations anywhere in this arc.

---

## Phase 25 — Editorial Luxury token & type swap

**Goal:** App-wide reskin to the locked visual system; zero structural change. Light-only (dark token blocks deleted, not maintained).

**Files:** `app/layout.tsx` (add Cormorant_Garamond + DM_Sans via next/font; JetBrains Mono stays loaded ONLY for the interim Wordmark/Mark — brand redesign is a flagged TBD, do not improvise), `app/globals.css` (locked tokens: bg #F3EEE4, card #FDFBF7, popover #EDE4D5, fg #241F1A, muted-fg #83766A, border #DED0BC, input #CBB994, primary=brass #A57C3F, brass-fg #FBF6EC, accent #EDE1C8, accent-fg #7A5A2A, states complete #5C7A52 / failed #A8483F / qa #B8842A / queued #83766A; DELETE dark blocks; radius 2-3px; --font-display Cormorant + --font-ui DM Sans; h1/h2 serif; motion layer retuned to the running token — assume brass, confirm with Matt), `components/brand.tsx` (StatePill → colored dot + tracked-uppercase DM Sans label, no tinted bg/border stripe; pulse-only-while-running preserved; Wordmark untouched + TODO(brand)), add `components/ui/select.tsx` + `components/ui/textarea.tsx` (radix installed), restyle button/card/input/label to hairline/2px.

**DoD:** build passes (no dev server running); dashboard + listing page + library render in new palette with serif headers; no dark flash under OS dark appearance; running pill pulses, complete doesn't.
**Manual test (Matt):** eyeball dashboard + a listing page against the mockup's luxury bar; confirm brass as the running-state color or name a different one.

---

## Phase 26 — Homepage redesign + prices off every surface (Matt, 2026-08-31, post-phase-25 reaction)

**Goal:** The dashboard becomes a luxury front door, not a cost report — and NO dollar figure renders anywhere in the app. Matt, verbatim: "we didnt do aynthing witht eh flow, the process etc... also remove the prices. WE were doing a full redsign of the flow, the homepage, etc no?" This kills the earlier "dashboard keeps $ spend" carve-out entirely; the spend ledger stays in the DB untouched (SpendLedger is a CLAUDE.md invariant), it just has no UI surface for now.

**Files:** `app/page.tsx` — REMOVE the MTD spend card (and its admin-client ledger fetch), REMOVE the per-listing BoxBrownie comparison + `centsLabel`/`bbCents`/BOXBROWNIE imports; redesign the page: serif greeting header, Recent listings as PHOTO CARDS (cover photo = first non-floor-plan photo by created_at asc — same derivable rule as the phase-29 hero, needs a small photos fetch + signed URLs), photo count + MLS as quiet DM Sans metadata, jobs-in-progress and failed-jobs cards restyled compact (StatePill + title + listing, rerun button stays). Grep the whole app for remaining `$`/cents renders (job-panel estimate line renders dollars via simulateCents — swap to "~N generations · <provider>" now rather than waiting for phase 30; plan-panel/reel-panel estimate lines same). `config/models.ts` BOXBROWNIE data stays (data, not UI).

**Not changed:** spend_ledger writes, cost tracking, /api anything; listing-page structure (phases 27–30 own that).
**DoD:** build passes; zero `$` or cents figures anywhere in rendered UI (grep + eyeball); dashboard shows photo-card listings with cover images; failed-job rerun still works.
**Manual test (Matt):** open the homepage — does it read as the product's front door; confirm nothing anywhere shows a price.

---

## Phase 27 — Tools move to their own routes + subnav

**Goal:** Aerial/reel/tour/plan leave the listing page; listing page slims to upload/photos/rooms/jobs.

**Files:** new thin server pages `app/listings/[id]/{aerial,reel,tour,plan}/page.tsx` (copy the proven `/copy` pattern — each fetches only its own data); move aerial-panel/reel-panel/tour-panel/plan-panel under their route folders (pickers intact for now); new `app/listings/[id]/tools-nav.tsx` (tracked-uppercase link row: Photos / Aerial / Reel / Tour / Plan / Copy, active by pathname) rendered on listing + tool pages; listing page drops the four panels + their fetches.

**DoD:** build passes; each tool page loads and can run its action (reel realtime still updates); mobile nav wraps cleanly.
**Manual test (Matt):** generate a reel from /listings/[id]/reel; annotate an aerial from its route.

---

## Phase 28 — FileGroup workspace route

**Goal:** Every FileGroup gets its own bookmarkable page; job cards become compact links.

**Files:** new `app/listings/[id]/f/[fileGroupId]/page.tsx` (server: one fg + job + versions + chat + photos, RLS-scoped, 404 if unowned) + `file-group-workspace.tsx` (client — TRANSPLANT job-panel L1022–1299: before/after, version pills, rework input, QA note, compliance checklist, dusk checks, download menu, plan exports/attach, 360 preview; serif title; narrow realtime channel filtered to the fg id — verify postgres_changes column filters work, fallback = unfiltered channel + client-side match); job-panel inline detail → compact card rows (thumb, title, StatePill, progress stripe, last user message, link — NO dollar figure); ideas cells link to /f/[fgId] (kills client `promoted` state).

**DoD:** build passes; rework from the new route shows a new version pill live; download + watermark toggle work from the route; job-panel ≈600–700 lines.
**Manual test (Matt):** open a completed output's page, rework it, watch the version appear; bookmark and reload the URL.

---

## Phase 29 — Shared photo tray + hero

**Goal:** One selection surface feeds everything on the listing page; full-bleed photo hero.

**Files:** new `app/listings/[id]/photo-tray.tsx` (ordered selectedIds, shift-click range select, arity hint chip, clear; grid + tray can be one component gaining selection affordances) + `listing-workspace.tsx` client wrapper composing tray + JobPanel via props (no context — one consumer); job-panel loses its picker strip + photoIds state; `page.tsx` gains the hero (first non-floor-plan photo by created_at asc, dark scrim, Cormorant address; zero photos → plain serif header).

**DoD:** build passes; shift-click range works; 1 selected enables chat/markup, N enables batch; hero renders and is mobile-legible; zero-photo listing degrades gracefully.
**Manual test (Matt):** select a range, run a batch enhancement; check the hero against the mockup.

---

## Phase 30 — The composer (interpret → materialize → estimate → Run)

**Goal:** One composer; chat never blind-spends; manual builder demoted; job-panel.tsx deleted.

**Files:** new `app/listings/[id]/composer.tsx` (chat + chips → /api/interpret; kind:"question" → assistant bubble, stay drafting, resend full messages; kind:"job"/"ideas" → materialize edit_chain into the SAME editable step state as the manual path — extract `chain-step-editor.tsx`; estimate line reads "~N generations · <provider>", NEVER dollars; single Run posts the possibly-edited chain + persisted chat to /api/jobs; ideas materialize as 4 labeled mini-chains with one Run; Enter-to-run when a chain exists); manual "precise chain builder" → collapsed native `<details>` feeding the same chain state; markup step enforces selection arity 1 + mounts MarkupCanvas; refs/URL-inspiration block moves in; new `job-feed.tsx` (compact cards + listing-wide realtime); DELETE job-panel.tsx; types move to job-feed or a types.ts. /api/interpret and /api/jobs contracts unchanged.

**Fallback if the session overruns:** ship materialize for kind:"job" only; ideas keep the auto-fire path one more phase (checkpoint protocol).

**DoD:** build passes; "stage this bedroom" → steps + estimate materialize → edit a step → Run → job lands in feed; ambiguous request → exactly one question → answer → materialize; markup with 2 photos selected is blocked with a message.
**Manual test (Matt):** the chat flow end to end on a real photo, including editing a materialized step before running.

---

## Phase 31 — Power accelerators + polish

**Goal:** Repeat-work speed for the 25-photos-weekly workflow.

**Files:** `composer.tsx` gains "Apply last chain to selection" (derived from the newest job's edit_chain — zero storage) and "Save as / apply listing default" (localStorage `ls:defaultChain:<listingId>` — single-user, no migration), rendered as chips above the chat box; polish pass replaces remaining raw `<select>`s (tool panels, copy-panel) with ui/select and sweeps stray mono/dark remnants.

**DoD:** build passes; run a chain → select 5 photos → apply-last-chain → Enter fires the batch; default chain survives reload.
**Manual test (Matt):** the apply-last-chain flow on a real batch.

---

## Phase 32 — Output-artifact brand pass

**Goal:** Downloads and reels match the brand; plan bands untouched.

**Files:** `lib/deliver.ts` applyWatermark (teal #7FD9D4 → brass #A57C3F; mono ref → serif/system stack — sharp renders with system fonts, test legibility at pill size), `lib/reel.ts` caption overlay (same swap). `lib/plan.ts` NOT touched — address/disclaimer bands stay pure black-on-white per DECISIONS.

**DoD:** build passes; a labeled staged download's pill and one reel caption frame eyeballed on-brand.
**Manual test (Matt):** download a staged photo with the label ON; generate a short reel and check the caption.

---

## Phase 33 — Public product home page + route split (Matt, 2026-08-31) ✅ DONE

**Goal:** A logged-out visitor lands on a real **public product home page** — the product's front door — with login between it and the dashboard. Matt clarified the intended IA after phase 26: "the home page is the actual product home page, then there is a login, a dashboard etc." Today `/` IS the auth-gated dashboard and unauthenticated visitors are bounced straight to `/login`; there is no public landing. This phase adds the missing first layer: **public `/` → `/login` → `/dashboard`.** Chose "build it as a new phase" over a quick minimal one (AskUserQuestion, 2026-08-31) — do it properly, Editorial Luxury, no prices (consistent with phase 26). Sequencing: appended as 33 but **can be pulled ahead of 27** if the public front door is the priority — Matt's call at resume (tell the next session which phase to run).

**Files:**
- Move the dashboard: `app/page.tsx` → `app/dashboard/page.tsx` (the phase-26 luxury dashboard, unchanged); `app/dashboard-live.tsx` moves under `app/dashboard/` (or stays and is re-imported) — update its import path in the moved page.
- New public `app/page.tsx` = the landing (server component, **no auth, no data fetch, no ledger, no `$`**): Editorial Luxury hero — brass Wordmark, Cormorant headline + tagline, a short what-it-does section, "Sign in" CTA → `/login`. Light-only tokens, mobile-legible, degrades with no images. Optional: `getUser()` — if already authed, the CTA reads "Go to dashboard" → `/dashboard` (don't force-redirect; the landing stays viewable).
- `middleware.ts`: the unauthed guard (line 32, `pathname !== "/login"`) must also allow `/` — change to allow both `/` and `/login` (everything else still bounces to `/login`). The authed-on-`/login` redirect (line 39) target `/` → `/dashboard`. `/` does NOT need a matcher exemption (the guard change covers it); keep the matcher as-is. NOTE the terms-gate carve-out: `<TermsGate>` returns null on `/terms` and `/login` today — add `/` so the gate never covers the public landing (it should only gate authed app surfaces, now under `/dashboard`).
- `app/auth/signout/route.ts` already redirects to `/login` — leave it (sign out → login is still right).
- Sweep `/`-as-dashboard links: the Wordmark link and any `href="/"` / `router.push("/")` that meant "the dashboard" → `/dashboard`. Grep `href="/"`, `push("/")`, `redirect("/")` across app/components. (Landing → login uses `/login`; landing's own Wordmark can stay `/`.)

**Not changed:** the dashboard's phase-26 design; `/login`, `/terms`, `/tour/[slug]`; any `/api`.
**DoD:** build passes; incognito `/` renders the landing with NO redirect to login; "Sign in" → `/login` → after login lands on `/dashboard`; the dashboard is no longer served at `/`; every former `/`-means-dashboard link points at `/dashboard`; terms gate never shows on the public landing; zero `$` on the landing.
**Manual test (Matt):** incognito → open `/` → the product landing shows (no login bounce); click Sign in, log in → dashboard at `/dashboard`; signed in, revisit `/` → landing still loads (CTA says "Go to dashboard").

---

## Phase 34 — Room browser + photo-tray filtering ✅ DONE

**Goal:** Replace the 26-card room accordion with one deliberate room workspace. Room selection controls the existing shared photo tray; the UI never creates a second photo gallery.

**Files:** `app/listings/[id]/page.tsx` removes the fixed Rooms sidebar and passes full room records + floor-plan choices into `ListingWorkspace`; new `app/listings/[id]/room-browser.tsx` provides a searchable, keyboard-usable selector with All photos / Untagged / individual rooms (duplicate names disambiguated), photo counts, one selected-room summary, inline edit/delete, and add-room disclosure; `listing-workspace.tsx` owns the active room filter, filters the existing `PhotoGrid`, clears selection when the filter changes, and keeps extraction accessible; `room-panel.tsx` is deleted; `upload-panel.tsx` drops its redundant upload-time room selector so the room browser is the single room navigation surface (photos retain their own tagging selector). Existing server actions and photo-tagging contracts stay intact.

**DoD:** build passes; All photos shows the whole tray; Untagged shows only unassigned photos; choosing a room shows only its tagged photos plus one compact room summary; search finds room name/type/dimensions; duplicate Bedrooms/Baths/Halls/W.I.C.s are distinguishable; changing filters cannot leave invisible photos selected; per-photo tagging, full-screen photo editing, batch selection, room add/edit/delete, and floor-plan extraction still work; mobile layout remains usable.

**Manual test (Matt):** on 11689 Elam Dr, switch All photos → Untagged → Primary Bedroom; search for “13′11”; verify the tray count/filter, edit the selected room, retag a photo and watch it leave/enter the filtered tray, then return to All photos.

---

## Phase 35 — Photo-first editing + Activity route ✅ DONE

**Goal:** The listing page is a photo workspace, not an operations console. Remove the permanently visible “New job” composer and Jobs feed. A user edits by opening a photo, or selects several photos and explicitly opens a batch editor. Background work lives on a separate, trustworthy Activity page.

**Files:** `app/listings/[id]/listing-workspace.tsx` removes the inline Composer + JobFeed, opens the existing Composer only inside the single-photo editor or an explicit batch-editor overlay, and shows a quiet “Edit started → View activity” confirmation after submission; `composer.tsx` removes internal “New job” language and nested card chrome, uses human action copy (“Describe the edit”, “Build edit”, “Start edit”), and accepts the surrounding editor context; new `app/listings/[id]/activity/page.tsx` fetches listing jobs/versions/photos and renders the realtime feed; `tools-nav.tsx` adds Activity; `job-feed.tsx` becomes an editorial activity list with one job-level status, useful output/input thumbnails, human labels, active progress, and technical grounding collapsed under details; FileGroup back-navigation points to Activity.

**Status semantics:** local development cannot receive fal webhooks. Activity must not claim a provider-complete request is still working indefinitely: the existing reconcile path remains the completion mechanism locally, while the UI uses human labels (`Waiting`, `Editing`, `Ready`, `Needs attention`) and shows one status per job.

**DoD:** build passes; listing page contains neither “New job” nor a Jobs section; clicking a photo opens its focused editor; selecting multiple photos reveals one Batch edit action and no composer until invoked; successful submission closes the editor and shows a link to Activity; Activity live-refreshes, shows one trustworthy status per job, hides raw grounding by default, and links every result to its FileGroup workspace; the two orange-wall jobs reconcile to complete locally; mobile overlays and activity rows remain usable.

**Manual test (Matt):** open a Living Room photo → describe a colour change → Build edit → review → Start edit; confirm the listing returns with “Edit started” and no job cards; open Activity and watch Editing become Ready; repeat with two selected photos using Batch edit.
