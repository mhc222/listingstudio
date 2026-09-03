# Claude reference — detailed conventions and architecture

Moved out of CLAUDE.md on 2026-09-02 to keep the always-loaded context small.
Read this file when working on the areas CLAUDE.md points here for. Content below is verbatim from the previous CLAUDE.md.

---

# Listing Studio — CLAUDE.md (permanent project memory)

Self-hosted real estate photo enhancement platform replacing BoxBrownie for a single power user.
Domain model mirrors BoxBrownie's API v2 job architecture; execution engine is AI image APIs instead of human editors.
Detail lives in PLAN.md. Decisions live in DECISIONS.md. Session state lives in PROGRESS.md.

## Domain model

- **Listing**: address, optional MLS number. Owns photos, jobs, plans, tours, copy.
- **Room** (optional, per Listing): name/type (matches staging ROOM_TYPE enum), dimensions (L x W, ceiling height, ft/m), notes. Photos taggable to a Room; untagged is fine. Listing can hold floor plan attachments (uploaded or produced by FLOOR_PLAN_REDRAW).
- **Job**: belongs to Listing. title, status (pending/processing/complete/failed), submitted/completed timestamps, total API cost.
- **FileGroup**: one per output, inside a Job. Exactly one primary image, 0+ reference images, 1+ EditTypes applied IN SEQUENCE (chained: each edit's output is next edit's input, sequential API calls), optional free-text comment appended to prompt, output file-size preset (original / under 10MB / under 5MB).
- **Rework**: any completed output reworkable with comment + optional new refs. Creates a new OutputVersion on the same FileGroup. All versions kept, nothing overwritten. Any version can be branched from.
- **Sample Library**: account-level reusable reference images, attachable to any FileGroup.
- **Cost simulation**: dry-run estimator before running (edit count x per-call cost by model). Per-model rates in a config file, never hardcoded. Assume 2.5 image generations per average FileGroup.
- **ChatMessage**: per-FileGroup conversation history (interpreter loop).
- **SpendLedger**: every API call logged with cost. Retries and auto-QA re-runs always counted. Never double-count.

## Edit type catalog (prompt templates in prompts.ts, named exports)

**Tier 1 (core, 90% of usage):**
- IMAGE_ENHANCEMENT: one pass — white balance, sharpen, straighten, lens correction, tone, blemish/dust, flash + photographer reflection removal, TV screen -> neutral scenic, fire in fireplaces, window exposure balance. Options: SKY_REPLACEMENT y/n + DAY_SKY_STYLE (any, clear blue, clouds blue, orange sunrise), GRASS_REPAIR y/n.
- TURN_ON_LIGHTS: warm glow on ceiling lights, lamps, chandeliers. Standalone or stacked.
- ITEM_REMOVAL: tier 1 minor / tier 2 full declutter — tiers change prompt aggressiveness only. User free-text says what to remove.
- VIRTUAL_STAGING: required ROOM_TYPE (Living Room, Kitchen, Dining, Main Bedroom, Bedroom 2-4, Bathroom/Ensuite, Office, Outdoor/Patio, Other) + FURNITURE_STYLE (Modern, Contemporary, Farmhouse, Traditional, Urban/Industrial, Mid-Century Modern, Hamptons, Commercial, Scandinavian). Optional FURNITURE_REQUIRED free text + reference images.
- DAY_TO_DUSK: exterior twilight (dusk sky + warm glowing windows). Interior siblings: bright daylight, golden hour, soft overcast (relight only).
- VIRTUAL_RENOVATION: user-described finish changes; light/mid/full tiers vary aggressiveness only.
- VIRTUAL_LANDSCAPING: exterior curb appeal — beds, plants, mulch, walkways, exterior paint, door color, porch furniture, lighting. Chains after IMAGE_ENHANCEMENT.
- COLOUR_CHANGE: one named element, all else untouched.
- SHADOW_REMOVAL: remove harsh cast shadows, even lighting.

**Tier 2:** FLOOR_PLAN_REDRAW (2D B&W / 2D Full Colour / 2D Colour Textured / 3D via isometric re-render per storey; options: units sq ft/sq m, furniture y/n, north arrow, address label, disclaimer; output SVG+PNG+PDF; NEVER infer plans from room photos), VIRTUAL_TOUR (Marzipano walkthrough from 360 panos, hotspots, room labels, share URL, iframe embed), COPYWRITING (Claude API: photos + beds/baths/sqft/features + tone -> headline, 100w, 250w MLS descriptions, editable with copy buttons).

**Tier 3:** AERIAL_EDITING (drone enhancement + manual Konva canvas: LOT_HIGHLIGHT, DROP_PIN, boundary lines; flattened PNG export; annotation is manual, not AI), PORTRAIT_RETOUCHING (conservative; identity preserved exactly), HDR_MERGE (3-9 brackets, exposure fusion in code not AI, optional chain to IMAGE_ENHANCEMENT), 360_* experimental variants (full-res equirectangular, flag for manual seam/pole review).

**Verbatim geometry constraints (never paraphrase):**
- Staging/renovation/enhancement: "Do not alter room dimensions, wall positions, window or door placement, flooring, ceiling height, or camera perspective. Furniture must be realistically scaled to the room."
- Landscaping: "Do not alter the house structure, rooflines, window or door placement, driveway footprint, lot boundaries, or camera perspective."

**OUT OF SCOPE (never build, never stub):** CGI renders from architectural plans, development site plans, retail background removal, automotive/marine variants.

## Interpreter loop (the differentiator)

Claude API, cheapest adequate model (Haiku-tier). System prompt in prompts.ts.
1. **Intent parsing**: free text -> strict JSON job spec validated against edit catalog (ordered edit chain, options, user language preserved as comment). Ambiguous required option -> ask exactly ONE clarifying question, else sensible default noted on job record.
2. **Prompt compilation**: parsed intent merged into hardened templates (geometry sentence, spatial anchoring, brightness cue in first 10 words, listing-photography suffix, context grounding). User language fills slots, never replaces template.
3. **Conversational rework**: chat panel beside before/after slider. Reaction -> corrective rework prompt -> new version. Full history stored per FileGroup.
4. **Auto-QA** (build after loop works): vision pass checks result vs request + failure modes (geometry drift; DAY_TO_DUSK: windows glowing that were dark, dusk sky vs shadow direction). One auto-retry with corrective instruction, then show best with QA note. Always in spend ledger.

UI: chat thread per FileGroup; structured chips (room type, style, edit type) above text box merge with typed language into one spec. Job cards show latest user message as description.

## Inspiration features
- **Ideas grid**: exploratory intent -> 4 deliberately diverse variants, labeled 2x2 grid; tap promotes to current version + refinement chat. 4 image calls = one "ideas" ledger entry.
- **By image**: paperclip on chat box -> upload or sample-library pick as style ref.
- **By URL**: fetch user-pasted URL, extract og:image + prominent imgs (min size filter), picker strip -> refs + saved to sample library. Graceful failure ("couldn't read that page, screenshot it and upload instead"). Never scrape beyond the single URL.
- **Style memory**: frequency count per sample-library image, suggested chip on new jobs. No ML.

## Context grounding (automatic)
Primary image tagged to Room with dimensions -> inject into staging/renovation/item-removal prompts ("The room measures 14 x 16 feet with 9-foot ceilings; scale all furniture and objects to these dimensions"). Listing has floor plan -> attach as extra reference on staging/renovation. Grounding used is recorded on job record. Room dimensions pre-fill FLOOR_PLAN_REDRAW labels; redrawn plans become grounding for later staging.

## Stack (do not substitute without asking)
- Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui
- Supabase: Postgres, Auth (single user; schema multi-user-ready, zero team UI), Storage (originals bucket immutable; outputs bucket versioned)
- fal.ai gateway via single lib/imaging.ts provider interface. Providers: DEFAULT Qwen-Image-Edit (~$0.021), QUALITY_FALLBACK Gemini 2.5 Flash Image (~$0.039, one click or on "geometry drifted" rework), CHAINED_EDITS Flux Kontext Pro (~$0.04, for 3+ chained edits), LOCAL_ENDPOINT stub (ComfyUI API format, env base URL, wiring is user's job). NEVER self-host FLUX Kontext dev / FLUX.2 dev weights (non-commercial). Optional UPSCALE step (Real-ESRGAN via fal, ~$0.001-0.01), default ON for full-res final downloads.
- Claude API for COPYWRITING + interpreter only
- Marzipano tours; sharp (resize, MLS presets, HDR fusion); Konva (aerial annotation)
- Vercel deploy. Keys in .env.local, documented in .env.example, never committed.
- lib/storage.ts wraps all storage access (future R2 swap; do not build R2 now).

## Job orchestration (critical — no timeouts)
Never await generation in a request handler. fal queue API + webhooks: submit returns immediately; webhook advances per-FileGroup state machine in Postgres (queued -> step N running -> step N complete -> next step submitted -> complete/failed), triggers next chain edit / auto-QA / upscale. Supabase Realtime pushes state to UI. Batch = many state machines behind concurrency gate (max 3 running). Retries and QA re-runs are state transitions, never in-function loops.
**Hardening (phase 3 definition of done, non-negotiable):** (a) idempotent webhooks — every transition a conditional update (`SET status='complete' WHERE status='running'`), duplicates are no-ops, never double-submit or double-charge; (b) verify fal webhook signature before acting; (c) reconciliation cron (every minute) polls fal by stored request_id for steps stuck >3 min in running, completes or fails them. If chain complexity exceeds this, log in DECISIONS.md and propose Inngest/Trigger.dev — do not adopt preemptively.

## Prompt engineering rules (prompts.ts)
1. Spatial anchoring in every staging/renovation template: light entry, furniture position vs walls/windows, material of each major surface. Never vague.
2. Brightness cue ("bright natural daylight") within first ten words of listing-photo templates.
3. One aesthetic per prompt. Specific materials ("light oak hardwood") over generic.
4. End listing templates with "wide-angle real estate listing photography, inviting and spacious."
5. DAY_TO_DUSK review UI shows two named checks: (a) no windows glowing in rooms dark in original, (b) dusk sky consistent with shadow direction. Fail -> re-run with corrective comment.
6. Seed templates from: cmd8/awesome-nano-banana-pro-prompts, yvalue/1k-awesome-nano-banana-prompts, amaan36/Nano-Banana-Pro-Prompts.

## Quality bar
- Templates in prompts.ts, named exports per edit type. User comments append, never replace.
- Geometry sentences verbatim (above).
- API failures: retry once with backoff, surface on job card with re-run button, never double-count spend.
- Mobile-usable. Uploads: jpg, png, webp, heic (convert server-side). Full-res originals preserved untouched.
- Compliance: "Virtually Staged" label toggle at download (corner watermark + "-virtually-staged" filename suffix). Default ON for VIRTUAL_STAGING and VIRTUAL_RENOVATION, OFF for enhancement-only.
- Downloads: original, full-res edited, web-res 1920px, MLS presets, per-listing "download all finals" zip.
- Dashboard: recent listings, jobs in progress, failed jobs, MTD spend by edit type, BoxBrownie cost comparison (~$1-2/listing vs ~$220).

## EXECUTION PROTOCOL
Every session:
1. Read CLAUDE.md, PROGRESS.md, DECISIONS.md first. Trust them over memory.
2. Execute exactly ONE phase from PLAN.md. Never start the next even with room to spare.
3. Commit after each meaningful unit. Never end a session uncommitted.
4. On definition of done: run build, fix type/lint errors, check phase off in PROGRESS.md, update Current state + Next action, log decisions, final commit "phase N complete: <summary>".
5. End turn stating the manual test and reminding the user to /clear.

Rules:
- Ambiguity: make the pragmatic call, log it in DECISIONS.md, keep moving. Only ask if expensive to reverse.
- Never refactor prior phases unless the current phase requires it; log the urge instead.
- Long session: checkpoint early, commit, update PROGRESS.md, tell user to /clear even mid-phase.

**Usage-limit checkpoint protocol** (all state in files + git, never conversation):
1. On "checkpoint now", any usage/rate-limit warning, or session degradation: stop new work, commit everything (half-finished work as "wip:" commit), update PROGRESS.md with surgical precision (files mid-edit, incomplete function/route, keystroke-level next action, commands still to run). End turn saying it's safe to switch.
2. TODO comments at every incomplete point, greppable as "TODO(resume)".
3. If `npm run build` fails at checkpoint, say so in PROGRESS.md with error summary.
4. Never reference "as discussed above" — put it in CLAUDE.md or PLAN.md.
5. Never let more than one meaningful unit of work sit uncommitted.

**Token discipline:** read narrowly (specific files/ranges); never print full files or large logs into conversation; targeted checks mid-phase, full build only at definition-of-done; no progress narration or ceremony; PROGRESS.md lean (done phases = one checked line); no subagents; don't reinstall/re-scaffold/regenerate unless something changed; heavy context mid-phase -> early checkpoint + /clear.

**RESUME COMMAND (works in Claude Code and Codex via AGENTS.md):**
"Read CLAUDE.md, PROGRESS.md, and DECISIONS.md, then continue with the next unchecked phase in PLAN.md following the execution protocol in CLAUDE.md. One phase only, checkpoint commits throughout, update PROGRESS.md when done."
