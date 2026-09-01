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

---

## Phase 36 — End-to-end task studio UX ✅ DONE

**Goal:** Make the full Listing Studio journey feel like one coherent real-estate photo workflow rather than a collection of internal job-building controls. Preserve the interpreter loop and ordered edit chains under the hood, but lead with the user's task, the selected listing photo, task-specific controls, one clear primary action, an honest progress state, and a visual result/rework workspace. Use EdenSign only as an interaction reference for the split task-controls/photo-canvas pattern; retain Listing Studio's Editorial Luxury identity and its stronger free-text, chained-edit, batch, version, QA, and delivery capabilities.

**UX contract first:** create and verify an implementation-ready `UI-SPEC.md` covering the complete golden path — public home → login → dashboard → listing → upload/rooms → photo or multi-view selection → task studio → progress → result comparison → conversational rework/version history → download/delivery — plus empty/loading/error/mobile/keyboard states. A dedicated UX researcher owns the journey contract and a separate UX checker challenges it before application code changes.

**Implementation scope:** replace the generic Composer-first modal with a photo-first task studio: a compact contextual control rail and a large image canvas; task choices use human names (Enhance, Stage, Dusk, Remove, Renovate, Change colour, More) and materialize the existing named edit-chain definitions; room-aware defaults come from the selected photo; same-room additional views reuse the shared listing photo set; free text becomes a contextual “Anything else?” accelerator and Advanced exposes chain order, references, output size, repeat/default-chain controls without dominating the main path. Submission must lead to a useful processing/result destination rather than returning the user to an unexplained listing notice. The FileGroup workspace becomes the visual result surface with before/after, human progress, download, refinement, QA, and versions in that order. Activity remains history, not the primary post-submit experience.

**Files:** planning UX spec (location chosen to match repository convention); `app/listings/[id]/listing-workspace.tsx`; `composer.tsx` may be replaced or decomposed into task-studio components while reusing `chain-step-editor.tsx` and `edit-types.ts`; `/api/jobs` response/navigation contract as needed; `app/listings/[id]/f/[fileGroupId]/{page,file-group-workspace}.tsx`; supporting components/styles and focused copy adjustments across the golden path where the UX audit identifies concrete continuity breaks. Do not inline imaging prompts or alter provider/orchestration invariants.

**DoD:** verified UX spec exists; opening a photo immediately presents a comprehensible task choice beside the image; choosing a task reveals only relevant controls; free text still compiles into a validated editable chain; batch/additional-view behavior is explicit and honest; one primary action starts work; successful submission opens a processing/result workspace for that exact edit; progress is trustworthy locally and in production; completed output is visually dominant with before/after, download, refine, QA, and versions discoverable without internal jargon; the user can move from landing to delivered image without encountering “job”, raw edit enums, provider names, duplicate galleries, or nested operations-card UI; keyboard, mobile, empty, loading, and error states are covered; TypeScript, lint, and production build pass after the port-3000 dev server is stopped.

**Manual test (Matt):** start at `/`, sign in, create/open a listing, upload and room-tag photos, open one photo, stage it with a room/style plus an extra instruction, add another same-room view, start the edit, watch progress on the exact edit workspace, compare/download the result, ask for a rework, inspect the prior version, then find the completed edit in Activity. Repeat with Enhance and a multi-photo batch on mobile width.

---

## Phase 37 — Staging direction + one-path studio UX

**Goal:** Make virtual staging behave like a restrained real-estate interior designer and remove the last duplicated task-building path. A user chooses one task, configures it, optionally adds another edit, starts it, and reviews the result without clipped controls or an ambiguous comparison state.

**Design inputs:** Apply the `redesign-existing-projects` audit to the existing Phase 36 flow and use a dedicated residential interior-design review of the staging prompt. Preserve Listing Studio's Editorial Luxury identity and the interpreter/edit-chain architecture. The mandated `GEOMETRY_INTERIOR` sentence remains a named export and is included verbatim.

**Files:** `app/listings/[id]/composer.tsx` replaces the simultaneous quick-task grid plus `+ Add edit…` dropdown with one task catalog: six common outcomes, an expandable All edit tools list before selection, and Add another edit only after a first step exists. `lib/prompts.ts` adds room-aware composition guidance that prioritizes focal points, realistic scale, circulation, restraint, and camera-facing listing composition; staging QA gains named checks for scale/clearance, focal-point obstruction, and physical plausibility. `components/before-after.tsx` and the FileGroup workspace constrain the comparison to the available viewport, keep the entire photo legible, start at a true 50/50 split, and avoid horizontal overflow. Supporting copy and accessibility states may be adjusted where the audit finds a direct break.

**Not changed:** provider selection, orchestration state machine, edit catalog values, storage schema, pricing, or the verbatim geometry-preservation sentence. No new staging-style dependency or model is introduced.

**DoD:** only one edit-selection path is visible at a time; All edit tools selects a task directly; Add another edit appears only after a first edit exists; staging prompts choose the minimum furniture needed to communicate room function, maintain clear circulation, respect the natural focal point/fireplace, avoid foreground-blocking furniture, and preserve realistic perspective/scale; staging QA reports actionable layout concerns and can drive the existing single corrective retry; before/after is fully contained at desktop and mobile widths with a clearly centered initial divider; TypeScript, lint, and production build pass after the port-3000 dev server is stopped.

**Manual test (Matt):** open the same living-room photo, confirm there is no duplicate Add edit dropdown, choose Stage, inspect the room/style controls, add an optional second edit, and start it. On the result page confirm the full photo and right-side controls fit without horizontal scrolling, the divider begins at center, and staging leaves the fireplace and main walking path clear.

---

## Phase 38 — Calm precision interface system (Apple-design pass)

**Goal:** Replace the remaining “AI form builder” visual language with a calm, direct creative workspace. Apply the installed `apple-design` principles as product-design guidance—not as an Apple clone: the selected photo stays dominant, controls sit close to what they affect, hierarchy comes from spacing/material/weight instead of repeated boxes, every press responds immediately, and motion remains truthful, interruptible where interactive, and accessible. Preserve Listing Studio’s warm brass identity and photo-first workflow while retiring the brittle 3px-square “Editorial Luxury” treatment and three-font hierarchy that currently makes the product feel assembled rather than designed.

**Design system:** use the platform system font for product UI and display hierarchy, with size-specific tracking/leading; keep the existing mark/wordmark but remove JetBrains Mono and decorative serif dependencies from application chrome. Adopt a deliberate radius scale (roughly 10px controls, 14–18px panels), neutral warm surfaces, restrained shadows, and translucent floating chrome only where it communicates elevation. Shared buttons and fields gain instant pointer-down feedback, clearer focus, and reduced-motion/reduced-transparency/high-contrast fallbacks. Borders become exceptional separators rather than the default container treatment.

**Core workflow:** the full-screen photo editor becomes a true desktop studio at tablet widths: a dominant dark image canvas and an independently scrolling control dock with floating close chrome. On mobile it stacks cleanly with the photo first. Task choice becomes a quiet outcome list instead of a six-cell box grid; selected task controls, saved edits, references, secondary edits, and output settings use progressive disclosure with softer grouping. Staging configuration preserves the existing validated options and defaults. Listing room/photo browsing and the result workspace inherit the same surface, typography, navigation, feedback, and control language so the transition from selecting a photo to editing, reviewing, refining, and downloading feels continuous.

**Files:** `app/globals.css`, `app/layout.tsx`, shared `components/ui/{button,input,select,textarea,card}.tsx`, `components/brand.tsx`, `app/listings/[id]/{listing-workspace,composer,chain-step-editor,room-browser,photo-grid,tools-nav,page}.tsx`, `app/listings/[id]/f/[fileGroupId]/file-group-workspace.tsx`, `components/before-after.tsx`, and focused dashboard/listing-shell styling where shared tokens alone are insufficient. No prompt, provider, orchestration, API, storage, schema, price, or edit-catalog behavior changes.

**DoD:** the app uses no Google-loaded display/body/mono fonts; application typography has a defendable system scale; the photo editor is side-by-side by 768px without horizontal overflow; its canvas remains visually dominant; common task selection no longer renders as a boxed grid; repeated hairline boxes are substantially reduced across the listing, studio, and result surfaces; buttons/controls visibly respond on pointer-down; elevated chrome has a clear material role; focus is visible; reduced motion, reduced transparency, and increased contrast have explicit fallbacks; the Stage path, plain-language interpreter, secondary edit, references, output size, batch editor, result comparison, refinement, versions, QA, and download controls remain functionally available. Browser QA passes at mobile, tablet, and desktop widths with no hydration or console errors. Lint and production build pass after the port-3000 dev server is stopped.

**Manual test (Matt):** open 11689 Elam Dr, move from room selection to a Living Room photo, open Stage, switch room/style/furnishing/showcase, add a direction, reveal a secondary edit, and return to task choice. Compare mobile and desktop. Open a completed result, drag and keyboard-adjust before/after, create a refinement draft, inspect versions/QA, and confirm the entire journey feels like one calm photo tool rather than stacked forms.

---

## Phase 39 — Studio interaction language completion

**Goal:** Finish the interaction work left deliberately incomplete by Phase 38 so the product behaves like one professional creative studio, not merely a better-styled form. Preserve the calm system typography and warm brass identity. Make task changes spatially continuous, replace operating-system form chrome with controlled application components, animate progressive disclosure truthfully, turn staging style into a visual decision, and keep the primary action unmistakable.

**Interaction system:** replace the shared native `Select` adapter with an accessible Radix Select implementation that preserves existing controlled/uncontrolled values, form names, disabled/required states, labels, and current call-site behavior while adding anchored popovers, checkmarks, grouped typography, optional descriptions, collision handling, and keyboard/typeahead support. Add one shared animated `Disclosure` based on Radix Collapsible: 180–220ms height/opacity transition, source-anchored indicator, interruptible state changes, and a reduced-motion cross-fade/static fallback. Replace native `<details>` in the studio, result rail, room browser, and Activity feed; output size becomes a direct custom select rather than a disclosure around a select.

**Studio continuity:** common tasks remain visible as a compact persistent mode rail after selection. The active indicator glides to the chosen task; task controls enter in the same rail with a short opacity/translate transition rather than the entire interface appearing to be replaced. “More tools” stays one anchored popover and secondary edits remain one animated disclosure. Stage keeps the quietly prefilled room selector, but furniture style becomes a visual material/mood swatch picker with label and selected check; Light/Standard remains a two-option segmented control and Showcase remains a compact focal-point choice row. Saved edits, references, alternate views, notes, and output settings remain available but no longer read as equal-weight stacked sections. The sticky primary action owns the strongest visual weight and includes the truthful photo/edit scope.

**Result and history:** processing continues to show the source image, but the true state and progress treatment live over the image as material chrome rather than as a detached status block. Result Download, Refine, Versions, QA, and Edit details use the same disclosure/select language and stronger primary-action hierarchy. Activity edit context and room add/edit/floor-plan controls use the shared disclosure so no snapping native details remain in the core journey.

**Files:** new shared primitives under `components/ui/` for custom select/disclosure (and a small anchored popover primitive only if needed); `app/globals.css`; `app/listings/[id]/{composer,chain-step-editor,room-browser,job-feed}.tsx`; `app/listings/[id]/f/[fileGroupId]/file-group-workspace.tsx`; supporting select call sites across listing tool panels where the shared adapter requires compatibility. No `lib/prompts.ts`, model/provider, API, orchestration, schema, storage, pricing, or edit-catalog changes.

**DoD:** no native `<select>` or `<details>` remains in the application source; every select opens a styled anchored popover with visible selected state and keyboard/typeahead behavior; server-action forms still submit their select values; task choices stay present after selection with a smoothly moving active state; task content transitions in place; all core disclosures animate height/opacity and remain keyboard accessible; Stage furniture styles read visually before their labels are read; selected room/style/level/showcase remain correct in the edit chain; processing state is legible over the source image; primary actions dominate secondary utilities; reduced-motion, reduced-transparency, increased-contrast, mobile, and focus behavior remain correct. Browser QA passes the listing → Stage → task switch → secondary edit → result → Activity journey at mobile, tablet, and desktop widths with no overflow, hydration, console, or accessibility errors. Lint and production build pass after the port-3000 dev server is stopped.

**Manual test (Matt):** open the Living Room photo on 11689 Elam Dr. Move across Stage, Enhance, Dusk, and back to Stage while watching the persistent task rail and control transition. Open every custom selector with mouse and keyboard, choose a visual furniture style, Light/Standard, and a Showcase focus, then open/close Saved edits, detail, another view, and Add another edit. Confirm the Start edit bar is the obvious finish. Open an existing result, inspect Download/Versions/QA/Edit details, then Activity and the room browser. Repeat once at phone width and with Reduce Motion enabled.

---

## Phase 40 — Photoreal staging style previews

**Goal:** Replace the deliberately schematic furniture-style illustrations with believable photographic previews so choosing a staging direction feels like an interior-design decision rather than a cartoon theme picker. Preserve the compact, scannable picker and its accessible selected state while making the visual promise honest: each preview communicates materials, palette, and mood, not an exact furniture layout that the generated result must reproduce.

**Assets:** generate one art-directed, consistent 3×3 contact sheet of high-end interior-photography vignettes ordered Modern, Contemporary, Farmhouse, Traditional, Urban/Industrial, Mid-Century Modern, Hamptons, Commercial, and Scandinavian. No text, logos, people, watermarks, illustration, or exaggerated CGI. Crop it into nine local WebP thumbnails under `public/staging-styles/` so the interface has no remote image, uptime, tracking, or licensing dependency. The thumbnails are decorative support for the existing visible labels; selection and keyboard behavior remain text-driven.

**Files:** generated assets under `public/staging-styles/`; `app/listings/[id]/chain-step-editor.tsx` removes the code-drawn sofa/lamp swatches and renders the corresponding local photographic preview. Small focused CSS adjustments are allowed for crop, contrast, and selected-state legibility. No edit values, prompts, provider/orchestration logic, API contract, schema, or staging defaults change.

**DoD:** all nine staging styles have distinct, coherent, photoreal previews; no cartoon/CSS furniture artwork remains; previews crop cleanly at desktop and phone widths; labels remain fully legible and do not depend on image content; selected, hover, focus, disabled, keyboard, and screen-reader behavior remains correct; the image payload is appropriately compressed and locally served; lint and production build pass after the port-3000 dev server is stopped.

**Manual test (Matt):** open the Living Room photo, choose Stage, scan all nine styles without opening another control, select Modern, Farmhouse, Urban/Industrial, Hamptons, and Scandinavian, and confirm each preview feels materially distinct while the selected check and label remain unmistakable. Repeat at phone width.

---

## Phase 41 — Curated real-photography staging references

**Goal:** Supersede Phase 40's generated photographic previews with curator-verified real interior photography. The Stage picker should feel credible enough for a professional listing workflow: every thumbnail must visibly support its assigned design label, the nine images must read as one considered set, and the application must retain local performance and provenance rather than relying on remote hotlinks.

**Curation contract:** source from Pexels because its current contributor policy rejects generative-AI uploads and its license explicitly permits commercial website/app use and modification. Evaluate candidates by furniture form, materials, palette, detailing, and architectural language—not search tags alone. An interior-staging design review must approve each mapping and flag adjacent styles that remain ambiguous. Avoid people, logos, prominent copyrighted artwork, recognizable branded products, and images whose composition depends on exterior scenery. Prefer consistent landscape, eye-level, naturally lit seating-area or room-detail photography that remains legible at thumbnail size.

**Assets and provenance:** download the approved originals, crop/compress them into local WebP files under `public/staging-styles/`, and add a human-readable source manifest alongside the assets with style label, photographer, Pexels page URL, download date, and license URL. Never hotlink or call the Pexels API at runtime. These images are UI examples only and must not be silently sent to fal.ai or any other model as staging references.

**Files:** replacement assets and provenance manifest under `public/staging-styles/`; `app/listings/[id]/chain-step-editor.tsx` changes only if filenames or presentation need a focused adjustment. No edit values, prompt compilation, provider/orchestration logic, API contract, schema, or staging defaults change.

**DoD:** all nine visible previews are source-verified real photographs; an interior-design review approves each style assignment and specifically distinguishes Modern/Contemporary, Farmhouse/Traditional, and Scandinavian/Hamptons; every asset has recorded provenance; no remote request is made by the picker; local WebPs are appropriately compressed; labels and accessibility remain authoritative; TypeScript, ESLint, and the production build pass after port 3000 is stopped.

**Manual test (Matt):** open Stage and scan the nine previews without reading their labels first; confirm the intended categories are recognizable, then inspect the provenance manifest for the photographer/source of any image. Repeat at phone width and confirm local image loading remains immediate.

---

## Phase 42 — Competitive end-to-end UX benchmark

**Goal:** Audit Listing Studio's complete production workflow as a single real-estate power user and compare it with current direct competitors and best-in-class adjacent creative-workflow products. Produce evidence-backed priorities for the next implementation arc without changing the intentionally frozen Phase 38–41 interface. This is research and recommendations only; no application code, visual-polish sweep, paid account, credit purchase, paid generation, or deployment is in scope.

**Research set:** benchmark BoxBrownie, Autoenhance.ai, ApplyDesign, Virtual Staging AI, and REimagineHome directly, plus Adobe Lightroom, Frame.io, Canva, and Photoroom as adjacent workflow references. Add another product only when it demonstrates a clearly relevant workflow pattern. Use the live Listing Studio product and local authenticated workflow, current first-party documentation, official public demos, and hands-on browser paths wherever access permits; distinguish observed behavior from documentation, marketing claims, and inference.

**Journey contract:** compare the same thirteen stages in every product: full-shoot upload and large-file handling; automatic sorting, bracket detection, rooms, and organization; choosing an editing outcome; applying presets or saved preferences; batch selection and batch application; combining multiple edits; progress and status communication; before/after review; regeneration, conversational rework, and variations; version history; download, delivery, and MLS readiness; mobile behavior; and empty/loading/error/recovery states. Record click count, decision count, and major friction for representative intake, edit, review/rework, and delivery journeys, using explicit `not found`, `not applicable`, or `not observable without paid action` states rather than guesses.

**Deliverable:** create `42-UX-BENCHMARK.md` with an executive verdict; the current Listing Studio journey map; direct-competitor and adjacent-pattern matrices; click/decision/friction comparisons; screenshots or precise primary-source links for material findings; `Steal / Adapt / Reject` recommendations; ranked P0/P1/P2 gaps; clear separation of usability defects from aesthetic preferences; proposed future implementation-phase order; patterns explicitly not to copy; and an evidence-based decision on whether the interface should remain frozen or be reopened. Give special weight to full-shoot intake, presets, batch application, truthful progress, result review, delivery, and whether the known >10 MB upload failure must precede all further interface work.

**Files:** `PLAN.md` for this phase checkpoint; `42-UX-BENCHMARK.md` for the audit; `PROGRESS.md` and `DECISIONS.md` for the final handoff and locked recommendations. Screenshots may be stored in a documentation-only evidence directory if they materially improve verification. Application source, runtime assets, schemas, prompts, providers, orchestration, storage behavior, and deployment remain untouched.

**DoD:** every named product has an evidence-aware journey comparison with current first-party links and actual browser observations where publicly accessible; inaccessible, account-gated, or paid-only behavior is labeled; Listing Studio is inspected in production and locally rather than inferred only from documentation; the known upload failure is explicitly ranked against all other gaps; recommendations are implementation-useful and separate usability from taste; `PROGRESS.md` and `DECISIONS.md` capture the final verdict and next approval gate; the PLAN checkpoint and final research checkpoint are separate commits; the worktree is clean; nothing is deployed.

**Manual review (Matt):** read the executive verdict and top-five changes, inspect the evidence behind each P0, decide which recommendations to approve, and only then append future implementation phases. No implementation begins during Phase 42.

---

## Phases 43–54 — execution and resume contract

The implementation arc below is approved for planning, not pre-authorized as one uninterrupted code run. Execute exactly one phase per context. The Phase 42 evidence in `42-UX-BENCHMARK.md` is the research source; do not reopen competitor research or the Phase 38–41 visual system unless a phase's own usability test produces contrary evidence.

**Start or resume every phase:**

1. Run `/clear` before beginning the phase.
2. Read `CLAUDE.md` end to end, then the first `ACTIVE HANDOFF` in `PROGRESS.md`, the newest `DECISIONS.md` entries, and only the current phase plus its direct dependency in `PLAN.md`.
3. Confirm `git status`, the last two commits, applied migration state, and whether the port-3000 dev server is running. Never run `npm run build` while that server is running and never move it to another port.
4. Resume from the exact committed checkpoint named in `PROGRESS.md`; do not repeat completed work, pull later-phase scope forward, or disturb unrelated user changes.

**Checkpoint discipline:** a migration or foundational contract lands in its own coherent checkpoint commit before dependent UI work. If a phase must stop early, first leave the code in a verified coherent state, update the top `ACTIVE HANDOFF` with completed/pending work, commands run, migration/deployment state, port-3000 state, and the exact next file/test, then commit that checkpoint. Never use `/clear` to escape undocumented partial work.

**Completion discipline:** verify the phase in proportion to risk, exercise its complete browser journey at desktop and phone widths, update `UI-SPEC.md` when the implemented journey contract changes, update `PROGRESS.md` and `DECISIONS.md`, make the final phase commit, and confirm a clean worktree. Do not deploy or apply a live migration without Matt's explicit approval in that phase. If a production build is required, stop port 3000 first and restart it on port 3000 afterward. The completion reply must state the manual test, commits, migration/deployment state, and the next resume seed, then stop.

**Resume seed format:** after `/clear`, Matt can say: `Execute Phase N from PLAN.md. Read the ACTIVE HANDOFF first and resume from its committed checkpoint.`

---

## Phase 43 — Secure resumable-intake contract

**Goal:** Establish the durable storage, ownership, and idempotency contract that removes Next.js request bodies from professional photo intake. This phase proves a >10 MB direct transfer and safe finalization without yet changing the listing upload UI.

**Storage and data contract:** add a private mutable `intake` bucket, durable upload batches/items rooted through listing ownership, deterministic upload-item/photo IDs, and server-generated user/listing paths. Replace the current bucket-wide authenticated storage policies for relevant app buckets with path-scoped ownership checks; a signed-in user must not read or write another user's object prefix. Use a unique upload-item→photo relationship plus conditional lifecycle transitions so prepare, transfer, finalize, retry, cancel, and cleanup are idempotent across Storage/Postgres crash boundaries.

**Original contract:** preserve the exact uploaded bytes as the immutable source original. Add explicit source/canonical paths: ordinary correctly oriented inputs may share a path, while HEIC or EXIF-rotated inputs keep the untouched source and create a separate immutable normalized working derivative for browser/model compatibility. Existing edit/provider code reads the canonical path; future “original” delivery can select the untouched source. Finalization validates listing ownership, actual object size/type, server limits, and path before inserting exactly one `photos` row. Initial limits are centralized at 50 MB per file and 100 files per selection; JPG/PNG/WebP/HEIC/HEIF remain accepted and PDF remains floor-plan-only.

**Likely files:** `supabase/migrations/0009_reliable_intake.sql`; a focused upload contract under `config/` and `lib/`; `lib/storage.ts`; authenticated prepare/finalize/cancel/status routes under `app/api/uploads/`; a non-UI verification harness and focused RLS/idempotency tests. `/api/upload` remains temporarily for existing UI callers until Phase 44.

**Not in scope:** queue UI, RAW, cloud-drive import, HDR/room analysis, presets, or any visual change.

**DoD:** a >10 MB file transfers directly to storage and finalizes through the new contract; raw bytes remain immutable; canonical normalization is explicit; unauthorized path access fails; spoofed type/size fails; double-finalize creates one photo; crash/retry tests cover object-written/row-missing, row-created/status-not-finished, cancellation, and cleanup boundaries; no original can be overwritten/deleted; TypeScript, lint, migration/RLS, and focused contract tests pass. Live migration application requires explicit approval and is recorded.

**Manual test (Matt):** authorize and finalize a >10 MB JPEG plus one HEIC through the contract harness, verify source bytes/path and canonical derivative behavior, repeat finalize, and confirm exactly one photo row per item and no cross-user access.

**Clear/resume gate:** commit the migration/storage contract and the verified harness as coherent checkpoints; update `PROGRESS.md` with migration state, crash-boundary results, exact limits, and port-3000 state; clean, stop, and `/clear` before Phase 44.

---

## Phase 44 — Full-shoot upload queue and recovery

**Goal:** Close the >10 MB P0 end to end by moving the listing/floor-plan upload UI onto Phase 43's direct resumable contract and making every file independently recoverable.

**Queue experience:** use `tus-js-client` against Supabase's supported resumable endpoint, with the currently recommended 6 MiB chunk target confirmed at implementation time and no more than three concurrent files. Preflight before reservation; show accepted formats/limits, filename, bytes, progress, and `Waiting / Uploading / Finalizing / Uploaded / Needs attention / Canceled` per item. Support pause/resume, cancel, retry-one, retry-failed, partial success, and reload recovery using durable upload rows plus the TUS fingerprint/URL store. Photos and floor plans share the queue while retaining their distinct validation contracts.

**Migration from the old path:** `app/listings/[id]/upload-panel.tsx` becomes a compact queue/launcher and no listing-intake bytes use `/api/upload`. Preserve that route only for any proven remaining small internal caller, otherwise remove it after call-site search. Failure copy names the file, cause, preserved work, and next action; one invalid item never resets successful items.

**Likely files:** `package.json`/lockfile; `app/listings/[id]/upload-panel.tsx`; focused queue/item/client modules; Phase 43 routes/contracts; upload browser/integration tests; `UI-SPEC.md`.

**Not in scope:** HDR grouping, room inference, RAW/cloud sources, presets, or unrelated interface polish.

**DoD:** a mixed 50-file queue containing >10 MB, HEIC, and one invalid file completes valid items; interruption/reload resumes without duplicate rows; pause/cancel/retry work per item; regular photos and floor plans retain correct metadata/behavior; no request hits the Next multipart limit; mobile/desktop browser QA, TypeScript, lint, and focused tests pass.

**Manual test (Matt):** upload three or more files including a >10 MB JPEG, interrupt one, cancel one, retry one, reload mid-transfer, and verify exact per-file recovery plus one photo row per success. Repeat a floor-plan upload.

**Clear/resume gate:** update `PROGRESS.md` with the tested batch, reload/retry outcomes, old-route disposition, migration state, and port-3000 state; commit, clean, stop, and `/clear` before Phase 45.

---

## Phase 45 — Shoot inventory, counts, and HDR bracket organization

**Goal:** Turn a successful intake batch into a trustworthy shoot structure. Preserve professional source identity, correct the dashboard/tray count mismatch, and propose HDR brackets without hiding or destroying any exposure.

**Data and organization:** preserve original filename, capture timestamp, intake order, relevant exposure/focal metadata, and source batch on each photo. Add durable photo groups with `hdr_bracket` kind, proposal confidence/reason, `proposed / confirmed / dismissed` state, ordered members, and one explicit representative. Detect likely 3–9 exposure stacks from capture timing, dimensions, camera/lens/exposure metadata, and a bounded luminance/visual fallback only where needed; uncertainty stays visible. The review surface lets the operator confirm, split, merge, reorder, dismiss, or mark files as separate singles. The existing HDR route must consume owned stored photo/group IDs rather than accepting another multipart file upload.

**Downstream identity:** before later batch/proofing/delivery work, define the unit of work. A confirmed group preserves every source exposure as immutable lineage but exposes one merged derivative as its editable/deliverable representative; unconfirmed groups expose their individual photos. Primary shoot counts, selection, proofing, approval, and delivery count logical representatives—not both a confirmed stack and all of its bracket members. The operator can reopen/undo a group and inspect source exposures, but no automatic merge hides or deletes them.

**Workflow:** after upload, show exact totals for photos, floor plans, pending bracket proposals, confirmed stacks, and items needing review. Dashboard counts must label photo totals separately from attachments. The listing photo tray remains the primary surface; organization controls should extend it rather than introduce a second competing gallery.

**Likely files:** `supabase/migrations/0010_shoot_organization.sql`; Phase 43/44 finalization metadata; a bracket detector/grouping helper under `lib/`; authenticated proposal/group routes; `app/dashboard/page.tsx`; `app/listings/[id]/{page,listing-workspace,photo-grid}.tsx`; existing HDR route/helper; `UI-SPEC.md` and focused tests.

**Not in scope:** automatic room assignment, generative editing, deleting source brackets, RAW ingest, or changing typography/materials.

**DoD:** source filename/order/metadata survive intake; the dashboard and tray report reconcilable file/representative/floor-plan counts; known 3-, 5-, and 9-exposure sets are proposed correctly; mixed singles remain singles; low-confidence sets require review; split/merge/reorder/dismiss persist; confirming and merging preserves every source, creates one traceable representative, and removes duplicate bracket members from downstream selection without deleting them; actions are listing-owned and idempotent; desktop/mobile browser QA, TypeScript, lint, and focused grouping tests pass.

**Manual test (Matt):** upload a folder containing two real bracket sets plus singles, verify the proposed groups and reasons, split one incorrect proposal, merge one missed member, confirm the correct stack, and verify the dashboard distinguishes photos, bracket stacks, merged results, and the floor plan.

**Clear/resume gate:** record the detector thresholds tested, representative/count contract, unresolved false positives/negatives, migration state, and exact merged-photo lineage in `PROGRESS.md`; add lasting grouping decisions to `DECISIONS.md`; commit, clean, stop, and `/clear` before Phase 46.

---

## Phase 46 — Room and same-view organization review

**Status (2026-09-01):** Complete. Migrations `0011_room_proposals.sql` and `0012_room_proposal_cleanup.sql` are live; no Phase 46 SQL remains pending.

**Goal:** Reduce manual room clerical work while keeping the human authoritative. Propose room labels and same-room angle groups that later batch editing can trust; never silently commit uncertain semantics.

**Proposal contract:** analyze representative single/merged photos and return a room type, optional match to an existing floor-plan room, same-room group key, confidence, and short evidence. Existing floor-plan rooms may be candidates, but photo vision must never invent dimensions, geometry, doors, windows, or authoritative plan placement. High confidence may preselect a review choice; all database changes occur only after explicit acceptance. The operator can accept all high-confidence items, correct a label, create/select another room, link or unlink same-room angles, defer an item, or leave it untagged.

**Workflow:** present proposals in the existing tray/room browser as an organization pass with `Suggested / Confirmed / Needs review / Untagged` filters and counts. Same-room groups become durable scope primitives for Phase 47 and later consistency prompts. Ledger any model-backed analysis using the existing allowed `interpreter` ledger kind plus an explicit room-analysis edit label, and make rerunning analysis deliberate rather than automatic on every page load.

**Likely files:** `supabase/migrations/0011_room_proposals.sql`; a named room-analysis prompt in `lib/prompts.ts`; model config and ledger integration; authenticated analyze/accept routes; `app/listings/[id]/{room-browser,photo-grid,listing-workspace}.tsx`; tests and `UI-SPEC.md`.

**Not in scope:** automatic furniture/layout consistency, inferring floor-plan geometry from room photos, applying edits, or hiding untagged photos from the shoot.

**DoD:** a mixed shoot receives reviewable room and same-view proposals; no room tag/group is persisted without acceptance; corrections and deferred items survive reload; same-room membership is clear and reversible; dimensions remain sourced only from floor plans/manual input; analysis cost and model are ledgered; failed/partial analysis leaves photos usable; ownership and idempotency tests pass; browser QA covers a floor-plan listing and a listing without one.

**Manual test (Matt):** run organization on a kitchen, living room, two bedroom angles, an exterior, and one ambiguous image; bulk-accept the obvious results, correct the ambiguous one, link/unlink the bedroom views, reload, and confirm the accepted room tags and groups are exact.

**Clear/resume gate:** `PROGRESS.md` must name the tested listing, accepted/corrected/deferred counts, model/cost, and any known confidence weakness. Commit the proposal/prompt contract before dependent review UI; finish clean, stop, and `/clear` before Phase 47.

---

## Phase 47 — Safe batch scope

**Status (2026-09-01):** Complete in local code. Migration `0013_batch_scope.sql` is verified and queued for Matt's end-of-run SQL batch; live migrations remain through `0012`. Nothing was pushed or deployed.

**Goal:** Close the mixed-room P0 with an exact, server-enforced target contract. Make existing range selection discoverable, add efficient group selection, and prevent any crafted or ordinary request from applying one implicit staging room to incompatible photos.

**Selection:** preserve the existing Shift-range implementation in `listing-workspace.tsx`/`photo-grid.tsx`; expose it instead of rebuilding it. Add Select all for the visible filter, room-group and same-room-group selection, mobile-friendly range/group actions, and clear. Every batch composer shows the exact logical representative count, rooms/groups, ordered task chain, output size, and estimated generation count. “Nothing selected” never means “everything,” and batch plain-language copy must describe only supported behavior.

**Server safety:** persist an immutable target/scope snapshot with the Job and support explicit per-target chains/options or a validated split into compatible room groups. `/api/jobs` recomputes ownership, representative identity, room/group compatibility, and allowed options; it rejects a crafted mixed/untagged Virtual Staging request without explicit room-specific overrides. Client blocking is guidance, never the safety boundary. Retries reuse the same target snapshot.

**Likely files:** `supabase/migrations/0013_batch_scope.sql`; `app/listings/[id]/{photo-grid,listing-workspace,composer,chain-step-editor}.tsx`; `app/api/jobs/route.ts`; a pure scope validator; orchestration/request tests and `UI-SPEC.md`.

**Not in scope:** presets, new edit types, prompt/provider changes, or redesigning the studio.

**DoD:** Select all/range/group selection works without N clicks; scope stays visible; logical HDR representatives—not source brackets—are targeted; the former two-untagged-photo Living Room defect is blocked or explicitly split; crafted API requests fail the same validation; per-target overrides persist; single-photo and compatible non-staging batch flows do not regress; RLS/idempotency, TypeScript, lint, and desktop/mobile browser tests pass.

**Manual test (Matt):** reproduce the former two-untagged-photo defect through the UI and a direct crafted request; confirm both fail safely, then split/override by confirmed room and verify only the displayed targets run.

**Clear/resume gate:** record the selection behaviors, scope snapshot, server rejection fixture, migration state, and target-count reconciliation in `PROGRESS.md`; commit, clean, stop, and `/clear` before Phase 48.

---

## Phase 48 — Named persistent presets

**Status (2026-09-01):** Complete in local code. Migration `0014_edit_presets.sql` is verified and queued with `0013_batch_scope.sql` for Matt's end-of-run SQL batch; live migrations remain through `0012`. Nothing was pushed or deployed.

**Goal:** Replace browser-local saved edits with reusable, validated production settings after batch scope is trustworthy.

**Preset contract:** add account-owned named edit presets with ordered chain/options, included-settings summary, timestamps, and optional account/listing/room default relationships. Strictly sanitize every stored/replayed chain against the current edit catalog and option schema. A preset can be applied to the listing, room/same-room group, explicit selection, or one photo, then overridden without mutating the saved definition. Offer a one-time explicit import of the existing `localStorage` listing default before retiring it as source of truth; keep Apply last as a separate recent-action accelerator. Rename/delete never alters historical jobs.

**Intake and scope:** expose preset choice during or immediately after Phase 44 intake, but always show the scope and included settings before application. No preset silently starts processing or resolves an incompatible mixed-room Stage batch.

**Likely files:** `supabase/migrations/0014_edit_presets.sql`; authenticated preset actions/routes; `app/listings/[id]/{composer,chain-step-editor,upload-panel}.tsx`; listing/page data wiring; validation helpers; tests and `UI-SPEC.md`.

**Not in scope:** a client/CRM entity, team sharing, silent auto-run, or new task/provider behavior.

**DoD:** named presets survive browser/device sessions; invalid edit chains/options are rejected; included settings and target scope are inspectable; account/listing/room defaults resolve deterministically; overrides do not mutate presets; legacy import is one-time and reversible until confirmed; historical jobs remain stable; RLS, TypeScript, lint, and browser tests pass.

**Manual test (Matt):** import or create “MLS warm clean,” set it as a listing default, apply it to one room group, override one photo, reload in a fresh session, and verify the saved preset and untouched definition.

**Clear/resume gate:** record schema/migration state, legacy-default disposition, validation fixture, default precedence, and scope test in `PROGRESS.md`; commit, clean, stop, and `/clear` before Phase 49.

---

## Phase 49 — Listing-level progress truth

**Status (2026-09-01):** Complete in local code. No migration was required; the workflow is a pure read projection over existing durable rows. Nothing was pushed or deployed.

**Goal:** Let the operator answer “What is happening, and what needs me?” from one surface before adding approval semantics.

**Operational model:** derive listing counts from durable upload, organization, Job, FileGroup, output, and failure truth rather than maintain a second mutable listing state machine. Expose `Uploading / Organizing / Queued / Editing / Review pending / Needs attention` counts with exact item drill-through. Finished outputs become reviewable immediately while other work continues; failed items link to the correct upload, organization, generation, or signed-image recovery. Dashboard summary and Activity use the same pure aggregation contract.

**Likely files:** a pure `lib/listing-status.ts`/query contract; dashboard and listing/Activity loaders; `app/listings/[id]/job-feed.tsx`; narrow realtime/reconciliation integration; tests and `UI-SPEC.md`.

**Not in scope:** approval/final selection, delivery, notifications, or a second orchestration state machine.

**DoD:** aggregate counts reconcile to underlying rows for active, partial, failed, and recovered fixtures; no unfinished/failed listing reads complete; completed items are accessible during partial processing; every failure has an item-specific action; realtime/reload settles to the same derived truth; TypeScript, lint, focused aggregation tests, and desktop/mobile browser QA pass.

**Manual test (Matt):** use a listing with an active upload, unresolved organization item, ready output, running output, and one failure; verify counts and drill-through, resolve/retry items, and confirm the summary reconciles without stale duplicate status.

**Clear/resume gate:** record the tested state matrix, reconciliation totals, realtime/reconcile coverage, and any deliberately derived wording in `PROGRESS.md`; commit, clean, stop, and `/clear` before Phase 50.

---

## Phase 50 — Contact-sheet proofing and final selection

**Status (2026-09-01):** Complete in local code. Migration `0015_proofing_and_finals.sql` is verified and queued after pending `0013_batch_scope.sql` and `0014_edit_presets.sql` for Matt's end-of-run SQL batch; live migrations remain through `0012`. Nothing was pushed or deployed.

**Goal:** Separate `Ready` from `Approved final` and make full-shoot review efficient enough to support safe delivery in Phase 51.

**Proofing workflow:** add a focused listing proofing workspace with contact sheet/filmstrip, room/status/QA filters, keyboard next/previous, fast before/after, version selection, `Approve final`, `Needs changes`, and `N of M approved`. Finished outputs can be reviewed while others process. Opening or comparing an image never implies approval.

**Final-selection contract:** add per-version review state and an explicit `photo_finals` record for each logical source representative. It can point to a valid output version or deliberately approve the untouched original. The server validates lineage, ownership, and logical HDR representative identity; one source has at most one active final and replacing it is atomic/idempotent. Later refinements never move the pointer. Needs-changes attaches to the reviewed version with an optional note/refinement path. Disable the unsafe listing ZIP when this phase ships; individual downloads remain until Phase 51 replaces it.

**Likely files:** `supabase/migrations/0015_proofing_and_finals.sql`; authenticated review/final actions; a focused proofing route/workspace; FileGroup workspace; shared `BeforeAfter`; listing navigation/Activity; tests and `UI-SPEC.md`.

**Not in scope:** package generation, team approvals/comments, or auto-approval.

**DoD:** keyboard proofing crosses a full shoot; original or one lineage-valid version can be approved per source; choosing another is atomic; later versions do not change the final; needs-changes persists; source brackets do not demand duplicate approvals; no viewing action approves; the unsafe ZIP is unavailable; RLS/idempotency, TypeScript, lint, and mobile/desktop browser tests pass.

**Manual test (Matt):** review a listing with processing, failed, bracketed, original-only, and multi-version items; approve one original and one older revision, mark another needs changes, reload, and verify exact finals/counts while new processing continues.

**Clear/resume gate:** record the fixture mix, approval/lineage invariants, unsafe-ZIP disablement, migration state, and review counts in `PROGRESS.md`; commit, clean, stop, and `/clear` before Phase 51.

---

## Phase 51 — Approved finals and MLS delivery

**Status (2026-09-01):** Complete in local code. Migration `0016_delivery_profiles.sql` is verified and queued after pending `0013_batch_scope.sql`, `0014_edit_presets.sql`, and `0015_proofing_and_finals.sql` for Matt's end-of-run SQL batch; live migrations remain through `0012`. Nothing was pushed or deployed.

**Goal:** Replace the unsafe “latest completed edits” ZIP with a previewable, reproducible MLS/client package containing only explicitly approved source finals.

**Delivery contract:** add account-owned named delivery profiles covering file format, dimensions/quality or size ceiling, watermark/virtual-staging disclosure, naming pattern, and ordering. Build a package preview from Phase 50's explicit source-final selections. Show included/omitted photos, original versus edited source, chosen version, room/order, generated filename, expected warnings, and missing finals before download. Block missing/duplicate selections; require acknowledgement for QA/compliance warnings; never silently fall back to the latest version.

**Package output:** use deterministic address/sequence/room or preserved-original naming, traversal-safe sanitization, collision handling, stable order, approved originals/versions only, optional disclosure companions, and a human-readable manifest recording source, selected version, transformation/disclosure, dimensions, bytes, and generation time. Replace JSZip's current whole-shoot buffering with a backpressured streaming archive or a durable asynchronous package artifact; the server recomputes the approved set at download time and peak memory must remain bounded as total package bytes grow. Replace or rename `/download-all` so no stale unsafe path remains.

**Likely files:** `supabase/migrations/0016_delivery_profiles.sql`; a new bounded package helper; `lib/deliver.ts`; authenticated delivery-profile/package routes; `app/api/listings/[id]/download-all/route.ts`; listing proofing/Activity/download UI; tests and `UI-SPEC.md`.

**Not in scope:** publishing directly to an MLS, claiming universal MLS compliance, client portals, or changing the visual brand.

**DoD:** the ZIP cannot include an abandoned/latest experiment unless explicitly approved; an older approved revision and an approved original export correctly; filenames are deterministic, traversal-safe, and collision-free; profile limits are enforced; virtual staging disclosure is explicit; manifest matches every file; missing finals and warnings fail visibly; another user cannot preview/download a package; a growing full-shoot fixture demonstrates bounded peak memory/backpressure; TypeScript, lint, focused package tests, and browser QA pass.

**Manual test (Matt):** approve a mix of originals, latest results, and one older revision; create an MLS profile; inspect the preview; resolve a missing final; download; verify order, names, dimensions/size, watermark/disclosure, and manifest, and confirm no abandoned output is present.

**Clear/resume gate:** record the exact package fixture, profile, validation results, memory measurement, ZIP contents, migration state, and old-route disposition in `PROGRESS.md`; commit, clean, stop, and `/clear` before Phase 52.

---

## Phase 52 — Version naming and variation comparison

**Status (2026-09-01):** Complete in local code. Migration `0017_version_labels.sql` is verified and queued after pending `0013_batch_scope.sql` through `0016_delivery_profiles.sql` for Matt's end-of-run SQL batch; live migrations remain through `0012`. No paid variation, push, or deployment occurred.

**Goal:** Make immutable history decision-useful without mixing it with batch orchestration. Let the operator name, understand, and compare branches while approved-final state remains stable.

**Version workflow:** add meaningful version labels, explicit parent/branch context, hover/list previews, and side-by-side comparison of any two lineage-compatible versions. Preserve branch-from-any-version and every current output. A variation request creates clearly labeled sibling outputs from one source/version with exact generation count/cost shown before submission; successful siblings remain usable if another fails.

**Approval safety:** creating/naming/comparing/generating a version never moves Phase 50's final pointer. Replacing the approved branch is a separate explicit action, and delivery continues to surface any needs-changes conflict.

**Likely files:** `supabase/migrations/0017_version_labels.sql`; version actions/API; FileGroup and proofing workspaces; a dedicated two-version compare built on the existing comparison primitive; variation submission/orchestration tests; `UI-SPEC.md`.

**Not in scope:** multi-photo conversational rework, implicit apply-to-all, provider replacement, or free/unbounded variations.

**DoD:** versions can be named and compared without changing approval; parent/branch lineage survives reload; variation count/cost is explicit; partial variation failure preserves siblings; an older approved final remains selected until explicitly replaced; RLS, TypeScript, lint, orchestration/idempotency tests, and desktop/mobile browser QA pass. A paid-generation test requires Matt's explicit approval.

**Manual test (Matt):** branch from an older result, name two directions, compare them side by side, create variations if authorized, and verify the existing approved final and delivery package remain unchanged.

**Clear/resume gate:** record version lineage IDs, variation authorization/cost/result, approval behavior, and migration state in `PROGRESS.md`; commit, clean, stop, and `/clear` before Phase 53.

---

## Phase 53 — Scoped conversational batch rework

**Goal:** Apply one correction safely across an explicit subset of results while preserving immutable per-target lineage, cost truth, and individual recovery.

**Scope contract:** select exact ready/approved outputs by photo, explicit selection, room group, or same-room group; enter a shared correction; then preview every target, source version, protected geometry, generation count/cost, and optional per-target exception. Persist the immutable request/scope snapshot plus an idempotency key before submission. No selection never means all. The server revalidates ownership, lineage, compatibility, and overrides, then creates one child version per target.

**Recovery and approvals:** report submission, processing, and failure per target; successful children remain available when siblings fail; retry reuses the stored snapshot/idempotency rules. New children never replace approved finals automatically, and protected geometry/prompt constraints continue through the existing compiler/orchestrator path.

**Likely files:** `supabase/migrations/0018_scoped_rework.sql`; batch-rework route/helper; proofing workspace; orchestration and prompt-compilation integration; cost/scope confirmation; tests and `UI-SPEC.md`.

**Not in scope:** team collaboration, implicit global corrections, provider/model changes, or approval automation.

**DoD:** a scoped correction cannot escape the displayed targets; per-target exceptions persist; duplicate submission is idempotent; partial failures are individually recoverable; approval pointers do not move; cost and lineage ledger reconcile; TypeScript, lint, orchestration tests, and desktop/mobile browser QA pass. Paid generations require Matt's explicit approval.

**Manual test (Matt):** choose exactly three exteriors, exclude a fourth, add one target-specific exception, submit if authorized, and verify only three immutable children are created while every other photo/version/final remains untouched.

**Clear/resume gate:** record authorization, scope snapshot/idempotency fixture, version/ledger IDs, partial-failure result, and approval behavior in `PROGRESS.md`; commit, clean, stop, and `/clear` before Phase 54.

---

## Phase 54 — Mobile intake/proofing and workflow-state hardening

**Goal:** Complete the operational arc on small screens and under interruption. Make intake, status, light proofing, approval, and recovery dependable on mobile without squeezing the full desktop Task Studio into a phone or starting another cosmetic redesign.

**Mobile contract:** optimize camera-roll/file intake, the resumable queue, organization decisions, listing status, contact-sheet proofing, before/after, approve/needs-changes, and delivery readiness for touch and constrained widths. Preserve resumability within web-platform limits, support reselect-to-reconnect after browser/OS eviction where necessary, and explicitly avoid promising native background upload after termination. Desktop remains the richer editing/configuration surface.

**State hardening:** cover empty listing, empty filter, invalid/oversized file, interrupted upload, expired auth, offline/reconnect, duplicate resume, organization-analysis failure, generation failure, stale signed URL, missing final, package warning, and download failure. Every state names what happened, what was preserved, and the smallest recovery action. Add a golden-path regression covering upload → organize → preset/batch → progress → review/approve → delivery, plus targeted accessibility, reduced-motion, keyboard, touch-target, and no-horizontal-overflow checks.

**Likely files:** Phase 43–53 workflow components and routes; shared empty/error/status primitives only when needed; signed-URL refresh and reconnect paths; integration/browser tests; `UI-SPEC.md`, `PROGRESS.md`, and `DECISIONS.md`.

**Not in scope:** a native iOS/Android app, service-worker offline editing, broad visual polish, team collaboration, cloud-drive import, or automatic MLS publication.

**DoD:** the golden path is usable at phone width with no document overflow; upload interruption/reload recovers without duplicates; all named empty/error cases have specific recovery; expired auth and signed URLs recover without losing work; light proofing and approval are touch/keyboard accessible; desktop behavior does not regress; TypeScript, lint, focused unit/integration/browser tests, and a production build pass after port 3000 is stopped. Restart port 3000 afterward. Deployment remains a separate explicit approval.

**Manual test (Matt):** on a phone-sized browser, start a multi-file upload, interrupt/reload/resume it, resolve one organization proposal, inspect aggregate progress, approve one result, recover an expired image URL, and confirm delivery readiness; repeat the complete golden path on desktop.

**Clear/resume gate:** update the top `ACTIVE HANDOFF` with the full Phase 43–54 completion state, remaining deferred items, verified commands, port-3000 state, migration/deployment inventory, and the next approved direction. Make the final implementation-arc checkpoint, confirm a clean worktree, stop, and use `/clear` before any release/deploy or new milestone.

---

## Phase 42 finding coverage

| Audit gap | Implementation phase |
|---|---|
| P0 reliable full-shoot intake | 43 secure contract → 44 queue/recovery |
| P1 source identity, counts, and HDR groups | 45 |
| P1 room/same-view organization | 46 |
| P0 safe batch scope | 47 |
| P1 named persistent presets | 48 |
| P1 listing-level progress truth | 49 |
| P0 approved finals + P1 proofing | 50 |
| P0/P1 approved MLS delivery | 51 |
| P2 version naming/variations | 52 |
| P2 scoped conversational rework | 53 |
| P2 mobile and empty/error/recovery states | 54 |

Locked boundaries across the arc: preserve the Phase 38–41 visual system; no RAW/cloud-drive/native-app scope; no multipart HDR upload; no automatic room/floor-plan geometry claims; no implicit “nothing selected means all”; `Ready` never equals `Approved final`; the unsafe latest-output ZIP stays disabled until replaced; and no live migration, paid generation, push, or deployment occurs without the phase's explicit approval gate.
