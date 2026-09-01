# Listing Studio — End-to-End UX Contract

Phase 46 · 2026-09-01 · implementation contract

## Product promise

Listing Studio should feel like a private photo studio for one real-estate power user. The user chooses a listing photo, chooses the outcome, adjusts only the details that matter, and stays with that exact edit through processing, review, refinement, and delivery.

The application may store Jobs, FileGroups, edit chains, providers, prompts, and versions. The interface speaks in photos, edits, results, and refinements.

## Experience principles

1. **The photo is the object of work.** It remains visually dominant from selection through delivery.
2. **Choose an outcome before configuring it.** Each task reveals its own controls; there is no universal wall of fields.
3. **Plain language is an accelerator, not homework.** “Describe it” can create or extend an edit, but a common edit never requires prompting skill.
4. **One screen, one primary action.** The next action is visually unambiguous and fixed where long content cannot hide it.
5. **Stay with the edit.** Starting work opens the exact processing/result workspace. Activity is history, not the destination.
6. **Progress must be true.** Local reconciliation and production webhooks update the same human states: Preparing, Editing, Ready, Needs attention.
7. **Complexity is disclosed progressively.** Ordered chains, references, output size, defaults, and technical QA remain available under Advanced or Details.
8. **Every version is safe.** Refinement creates a new version; it never silently replaces the selected result.

## Information architecture

```text
Public home → Sign in → Dashboard → Listing
                                   ├─ Photos → Task Studio → Edit Workspace → Download
                                   │                          └─ Refine → new version
                                   ├─ Aerial
                                   ├─ Reel
                                   ├─ Tour
                                   ├─ Plan
                                   ├─ Copy
                                   └─ Activity (history and recovery)
```

The Photos route owns upload, room filtering/tagging, photo selection, and entry into editing. Specialty tools keep their routes. The edit workspace is a durable URL and owns progress, result review, versions, QA, refinement, and download.

## Golden path

### 1. Public home

- Lead with the result and the plain-language workflow.
- Primary CTA: **Sign in** or **Open dashboard**.
- Do not show per-photo pricing, internal chain diagrams, or implementation terminology.
- The before/after demonstration may say geometry is preserved; it must not paraphrase the mandatory prompt sentence as if it were the literal compiled prompt.

### 2. Sign in

- A quiet, single-purpose screen with email, password, one Sign in action, visible errors, and a return-to-home link.
- Preserve the intended destination when authentication middleware supplies one; otherwise go to Dashboard.
- Loading disables the form and keeps its label stable enough to prevent double submission.

### 3. Dashboard

- Primary content: recent listings with cover photo, address, MLS, photo count, and latest useful state.
- Primary action: **Create listing**. The compact address/MLS form is acceptable for a power user.
- “In progress” and “Needs attention” are recovery summaries linking to the exact edit workspace. Do not show raw titles or enum-derived chains.
- Avoid a second visually different listing-management experience unless `/listings` is needed for the full archive.

### 4. Listing / Photos

- Hero confirms the active property. The tool navigation is persistent and secondary.
- Upload actions remain compact above the workspace.
- One searchable room selector filters one shared photo tray. A photo has one room tag control.
- Clicking the image opens Task Studio. The corner selection control builds an ordered batch without opening the photo.
- Empty state says what to upload and provides the action. A filtered-empty state offers **Show all photos**.

#### Full-shoot intake

- **Upload photos** and **Attach floor plan** stay compact above the shared tray. They feed one queue, while PDF remains valid only through the floor-plan action.
- Before reserving server work, validate every selected file independently against the published contract: JPG, PNG, WebP, HEIC/HEIF; floor-plan-only PDF; 50 MB per file; 100 files per selection. One invalid file becomes its own **Needs attention** row and never resets valid neighbors.
- Each reserved item transfers directly to private intake storage in 6 MiB resumable chunks. No more than three file pipelines may be active at once; listing and floor-plan bytes never pass through a Next.js multipart request.
- Every row shows filename, kind, byte size, determinate progress, and exactly one human state: **Waiting**, **Uploading**, **Finalizing**, **Uploaded**, **Needs attention**, or **Canceled**.
- An uploading item offers **Pause** and **Cancel**. A paused item offers **Resume**. A failed item offers **Retry**; the queue also offers **Retry failed** without touching completed rows.
- Reload rebuilds nonterminal work from owned durable upload rows. Browser-held file bytes cannot survive a reload, so an interrupted row asks the user to choose the exact same filename and byte size; the TUS fingerprint/URL resumes preserved chunks instead of reserving a duplicate photo.
- Failure text names the file, the recoverable cause, what work remains preserved, and the next action. Raw TUS, Storage, token, bucket, or request vocabulary is not customer-facing.
- The queue stacks controls below row detail at phone widths and must not create horizontal page overflow. Completed photos refresh into the existing shared tray; completed floor plans retain their floor-plan behavior.

#### Shoot inventory and HDR organization

- Intake preserves original filename, source batch, exact selection order, capture timestamp, dimensions, exposure time/bias, aperture, ISO, focal length, camera, and lens when present in the immutable source. Missing EXIF stays missing; the interface never invents capture facts.
- **Shoot inventory** extends the shared photo workspace above Rooms & photos. It shows separate, reconcilable totals for **Source photos**, logical **Photos ready**, **Floor plans**, **Proposed stacks**, **Confirmed stacks**, and **Merged results**. The dashboard uses logical photo count and labels floor plans and source files separately.
- **Find HDR brackets** is deliberate, never automatic on page load. A proposal contains 3–9 same-batch frames and shows confidence plus a short evidence sentence. Strong proposals use capture timing, dimensions, camera/lens/focal context, and exposure settings; brightness is a bounded low-confidence fallback only when capture timing exists and exposure EXIF is incomplete.
- Every proposal remains visible until reviewed. The operator may reorder exposures, remove members to split a proposal, add an ungrouped missed exposure, create a manual stack, **Keep separate**, or **Confirm & merge**. A saved manual change says **Manual** and replaces stale detector evidence with a reviewed-source explanation.
- **Keep separate** is durable: dismissed members remain normal photos and are not immediately reproposed. **Reopen stack** restores all source exposures as downstream photos and preserves the prior merged derivative as lineage. Reconfirming creates a new immutable merged result.
- A confirmed stack preserves every source exposure but contributes exactly one current merged representative to Rooms & photos, selection, later proofing, approval, and delivery. Its members are inspectable in organization but cannot start a new edit directly. Proposed stacks continue to expose their individual source photos.
- HDR fusion consumes owned stored group/photo IDs. The browser never reuploads bracket bytes, and the route never accepts multipart source files.

#### Room and same-view organization review

- **Room review** follows shoot/HDR organization and uses only the current logical photo set. It never analyzes floor plans, hidden confirmed bracket sources, or stale merged derivatives as room photos.
- Analysis is deliberate through **Suggest rooms** or **Run room review again**; it never runs on page load. The review call uses contact sheets labeled to exact owned photo IDs and records its model, cost, status, analyzed count, and partial/error note. A failed or partial pass leaves the tray and all existing room tags usable.
- A proposal contains canonical room type, short room name, optional match to an existing owned room, optional same-room angle key, confidence, and one observable evidence sentence. It never supplies dimensions, plan geometry, adjacency, hidden openings, furniture, edits, or authoritative floor-plan placement.
- The shared tray has mutually understandable **Suggested**, **Confirmed**, **Needs review**, and **Untagged** filters with counts. Existing manually tagged photos without proposals count as Confirmed; deferred and untouched photos count as Untagged.
- Confidence at or above 80% may preselect a review choice when the canonical type is known. **Accept clear suggestions** remains an explicit action. `other`, ambiguous views, malformed/missing responses, and confidence below 80% remain Needs review.
- Each pending card keeps the photo visible and offers an existing-room choice or editable new room name/type, an explicit same-room-link checkbox when applicable, **Confirm room**, and **Leave untagged**. Creating a room from a photo proposal never adds dimensions.
- Confirmation is the only path from proposal to `photos.room_id` or durable same-room membership. Repeating the same decision is idempotent. Corrected labels, accepted room IDs, deferred state, and groups survive reload.
- Two or more confirmed photos may be selected with the existing corner control and explicitly linked as views of one room. The server requires current logical photos with exactly one confirmed room. Every grouped card states the view count and offers **Unlink**; falling below two useful angles removes the group.
- Manually changing or clearing a confirmed room removes stale same-room membership. Clearing the room returns its current proposal to the durable untagged/deferred state. Deleting a Room does the same before its accepted proposal reference is cleared.
- Room proposals are organization evidence, not edit instructions. They do not apply image edits, promise cross-view furniture consistency, or hide untagged photos from selection.

#### Safe batch scope

- The existing corner control remains the one selection model. Its numbered state preserves selection order. Desktop Shift-click selects the inclusive range between the anchor and endpoint; **Choose range** exposes the same two-endpoint action for touch and keyboard users.
- **Select all visible** means the current room and organization filters only. Room and same-room-group actions name their scope and exact visible count. **Clear** is always available after the first selection. No empty selection ever expands to the listing.
- Opening a batch shows an **Exact batch scope** summary before outcome controls: logical representative count, room distribution including Untagged, durable same-room groups, ordered edits, output size, and estimated image passes. Confirmed HDR source exposures and stale merged derivatives cannot enter this scope.
- A multi-photo Virtual Staging batch may share one chain only when every target belongs to the same confirmed room and the requested staging room type matches that room. Mixed confirmed rooms require the explicit **Use each photo's confirmed room settings** action, which materializes and persists one room-matched chain per target without changing the reusable draft. Untagged staging targets must be organized first.
- The browser guidance and disabled Run action are not the security boundary. `/api/jobs` re-reads owned photos, current HDR representative identity, room type, and same-room membership; reconciles exact ordered targets; and rejects mismatched, reordered, mixed implicit, or untagged staging requests.
- Every accepted job records one immutable scope snapshot with a retry identity, exact ordered target/room/group/lineage values, per-target chains, output size, and generation count. A network retry reuses that identity only for the same snapshot; later retries and orchestration continue from the stored Job/FileGroups rather than recomputing “current selection.”

#### Named persistent presets

- Saved presets are account-owned server records, not browser defaults. Each has one unique account name, an ordered current-catalog edit definition, output size, an included-settings summary, and created/updated timestamps. Internal rework, source-bound markup, unknown edits, unknown option keys, invalid enums, and wrong option types cannot be saved.
- Authenticated clients can read only their own presets/defaults. Create, rename, delete, and default mutations pass through authenticated server routes after an owned read; the server sanitizer is the only write path. Deleting or renaming a preset never changes historical Jobs because every submission receives a copied chain inside its immutable Phase 47 scope.
- Default precedence is deterministic: a confirmed single-room scope uses room → listing → account; mixed-room or untagged scopes use listing → account. A default is recommended, never silently applied, and no preset automatically starts processing.
- A preset may fill the editable draft for one photo, an explicit selection, a visible-listing selection, a Room, or a same-room group. The operator sees the exact photo/room/group scope plus the preset's edit order and output size before choosing **Apply**. Applying deep-copies the definition, so later per-photo or per-batch overrides never mutate the saved preset.
- Intake may prepare a server preset for the next draft. This stores only a temporary preset ID, states that target scope has not yet been chosen, and requires explicit application after exact photo selection. It never stores another browser-local chain or submits work.
- **Apply last edit** remains a separate recent-action accelerator. The old `ls:defaultChain:<listingId>` value is offered only as a one-time validated import preview; **Not now** leaves it reversible, and a successful server save retires that browser value as source of truth.

### 5. Task Studio

Desktop is a full-screen split surface:

- **Control rail:** 22–26rem, scrollable content, its header and action footer remain visible.
- **Canvas:** takes the remaining space, neutral dark-warm surround, selected image contained at maximum useful size.
- Close returns to the same listing/filter/selection context. Escape closes only when no destructive drawing or pending submission needs confirmation.

Mobile is one column: photo preview first (not taller than 42vh), controls next, sticky action footer. It is not a squeezed two-column modal.

#### Entry state

Header: room label when known, then **What should we do with this photo?**

Primary tasks:

| User label | Internal starting step | Required controls |
|---|---|---|
| Enhance | `IMAGE_ENHANCEMENT` | finish; sky and lawn options only when relevant |
| Stage | `VIRTUAL_STAGING` | room type; furniture style; optional requested furniture |
| Dusk | `DAY_TO_DUSK` | light preset |
| Remove | `ITEM_REMOVAL` | removal scope; items to remove; markup path available |
| Renovate | `VIRTUAL_RENOVATION` | renovation depth; requested changes |
| Change colour | `COLOUR_CHANGE` | surface/object; new colour |
| More | catalog | lights, landscaping, shadows, portrait, 360, and other supported steps |

Task buttons are a compact two-column list, not marketing cards. Each has a short outcome phrase. Selecting one materializes the existing validated step defaults and moves directly to its controls.

Below the tasks, **Or describe the result** accepts plain language. Interpreting may ask one clarifying question at a time. A compiled result becomes the selected task/ordered steps and is editable before submission.

#### Configured state

- Header names the outcome: **Stage this room**, **Enhance this photo**, etc.
- Show only the selected task’s controls, using explicit field labels.
- Room type defaults from the photo’s room tag when the stored canonical `rooms.room_type` maps to a supported prompt value. The listing workspace must pass that canonical value into the studio; never infer it from a display label.
- Enhancement keeps sky and lawn repair under **Optional adjustments** until the photo model has a trustworthy interior/exterior classification; do not guess relevance from the image name or room label.
- **Anything else?** captures optional nuance and can ask the interpreter to add or revise steps.
- **Add another view** shows unselected photos from the same tagged room first, then all listing photos. Copy must say **Apply these settings to another view**; it must not promise identical furniture placement unless the generation engine actually guarantees it.
- Selected extra views appear as removable thumbnails. They become one batch with one FileGroup per photo.
- **Advanced** contains ordered edit steps, add-step catalog, reference images/URLs, output size, apply-last-edit, listing default, and generation estimate. Provider/model names and prices never appear.
- Markup opens the drawing canvas without losing the draft.

#### Action footer

- One primary action: **Start edit** or **Start edit on N photos**.
- Disabled state is explained immediately above the action when required data is missing.
- While posting: **Starting edit…**, action disabled, Close disabled.
- Submission state is owned or surfaced to the dialog shell so Close and Escape cannot dismiss an in-flight post.
- Interpreter and submission requests use network error handling with `finally` cleanup. On API or network error: remain in place, preserve every field, state the recoverable problem, offer Retry, and never leave **Understanding…** or **Starting…** stuck.
- On success: navigate to the first returned FileGroup workspace. Never close back to the listing and discard the returned IDs.

### 6. Edit workspace: processing

The workspace URL is `/listings/[listingId]/f/[fileGroupId]`.

- Top bar: back to Photos, property address, human edit title, Activity link.
- Batch work adds **1 of N** with previous/next thumbnails or controls, derived from sibling FileGroups in the same Job.
- The server page must supply the property address, human edit title, Job identity, and sibling FileGroup IDs/primary-photo thumbnails to the client workspace; `fg` plus one source image is not a sufficient view model.
- Main stage keeps the original photo visible with a restrained developing overlay.
- Status language: **Preparing your edit**, **Editing photo**, or a step-specific human message. Never “Step 1/2 · running”.
- Explain: **You can leave this page. The edit will keep running.**
- Local development polls the authenticated listing reconcile endpoint while active and refreshes after a successful reconciliation; production realtime remains primary.
- A failure keeps the source image, names the actionable problem, and offers **Try again** plus **Back to photos**.

### 7. Edit workspace: result

Visual order:

1. Result canvas / before-after comparison
2. Primary actions: **Download** and **Refine**
3. Version selector
4. QA / MLS checks
5. Edit details and original conversation

Requirements:

- Result is the largest element on the page.
- Before/after slider has keyboard support and readable labels.
- Download opens a compact disclosure: size, staged-label toggle when applicable, then **Download photo**.
- Refine is a clearly labelled text field: **What should change in this version?** with **Create new version**. Enter submits only when focus is in that field and a message exists.
- Version choices use **Original edit**, **Revision 1**, etc., with branch/source detail in secondary copy; raw `v2` may remain supplemental.
- Selecting a prior version updates the comparison, QA, and rework parent visibly.
- QA is summarized as **Ready for MLS**, **Review recommended**, or **Needs attention**. Raw notes/checklists live in a disclosure.
- Conversation and compiled edit chain live under **Edit details**, not above the result.

### 8. Activity

- History and recovery only: thumbnail, human edit title, listing/room context, time, one status, and link to exact workspace.
- No nested file-group boxes, duplicate status, raw grounding, provider names, or enum labels.
- Filters may be added later only if volume warrants them.

## Cross-screen language

Use: photo, edit, result, refinement, version, activity, prepare, ready, needs attention.

Avoid in customer-facing UI: job, FileGroup, chain, materialized, run, provider, model ID, raw enum, grounding, webhook, reconcile.

Internal “chain” may appear only inside the Advanced disclosure as **Edit order**.

## States and recovery

| State | Required response |
|---|---|
| No listing photos | Explain accepted input and show Upload photos |
| Upload waiting | Keep its place in the queue; show filename, bytes, and Waiting |
| Upload active | Determinate per-file progress with Pause and Cancel; never a batch-only spinner |
| Upload interrupted | Preserve successful neighbors and uploaded chunks; name the file and offer Retry or exact-file reselection |
| Upload finalizing | Say Finalizing until the durable photo row exists; reload may safely re-enter finalization |
| Upload complete | Say Uploaded and refresh the shared tray without clearing neighboring failures |
| Upload canceled | Say Canceled; do not create a photo row |
| Room filter has no photos | State the active filter and offer Show all photos |
| Room analysis active | Keep every photo usable; say Analyzing rooms; prevent a duplicate click |
| Room analysis partial | Keep valid proposals; name how many photos still need manual review |
| Room analysis failed | Preserve prior proposals/tags and say that existing organization was not changed |
| Room suggestion pending | Show confidence, evidence, proposed/new room choice, Confirm room, and Leave untagged |
| Room suggestion deferred | Keep the photo visible and count it as Untagged after reload |
| Interpreter working | Keep input and photo visible; use “Understanding your edit…” |
| Interpreter question | Show one question beside the answer field; preserve prior choices |
| Submission failed | Preserve draft, inline error, Retry |
| Generation active | Source photo, truthful state, leave-page reassurance |
| Generation failed | Source photo, plain error, Try again, Activity link |
| Output ready | Result dominant, Download primary, Refine secondary |
| QA warning | Keep output viewable; explain what needs visual review |
| Signed URL/image fails | Neutral frame, Retry image, never collapse controls |

## Accessibility and input behavior

- Dialog has an accessible name, focus enters the rail heading, focus is trapped, and returns to the triggering photo.
- Every icon-only control has a visible tooltip and accessible label.
- Task selection is a radio-like single selection with visible focus and `aria-pressed`/selection semantics.
- All form controls have persistent labels; placeholders are examples, not labels.
- Minimum pointer target is 40×40px for the task studio and photo selection.
- Batch order is announced and not encoded only by colour.
- Status uses text plus colour. Motion respects `prefers-reduced-motion`.
- Upload progressbars have per-file accessible names and numeric values; status is never colour-only.
- On mobile, the sticky footer never covers the last control and safe-area padding is included.

## Visual contract

- Keep Editorial Luxury: warm linen, cream surfaces, brass action, serif display, humanist sans UI, hairline borders, 2–3px radii.
- The canvas surround may be a dark warm neutral because it is a photographic viewing surface, not a return to application dark mode.
- Avoid nested bordered boxes. Separate sections with space, hairlines, or typographic hierarchy.
- No orange EdenSign imitation, glossy gradients, oversized pills, credit badges, or generic SaaS card grids.
- Photography remains the colour and emotional focus.

## Phase 36 priority

### P0 — implement now

- Task-first split-screen studio for single and batch edits.
- Contextual task controls using existing edit definitions and interpreter.
- Same-room additional-view picker with honest batch language.
- Direct navigation from successful submission to exact FileGroup workspace.
- FileGroup processing/result redesign, local reconciliation, batch sibling navigation.
- Human language sweep across the golden path, including removal of visible per-photo price claims.
- Keyboard/mobile/error states for changed surfaces.

### P1 — follow-up after the golden path is proven

- Dashboard recovery cards deep-linking to exact workspaces.
- Destination-preserving login.
- Full archive refinements and activity filtering.
- Photo-to-room auto-match and true cross-view staging consistency when supported by the generation layer.

## Acceptance journey

Starting from `/`, the user can sign in, create or open a listing, upload and room-tag photos, open one photo, choose Stage, accept the room-derived default, choose a furniture style, add an instruction and another same-room view, start the edit, land on the exact processing workspace, leave and return, compare/download the ready output, request a refinement from a selected version, and find the work later in Activity. No step exposes internal orchestration vocabulary or a second disconnected photo gallery.
