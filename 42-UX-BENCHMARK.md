# Phase 42 — Competitive end-to-end UX benchmark

Research date: 2026-09-01

Scope: research and recommendations only; no application code or production deployment

Primary user: one high-volume real-estate photographer/operator taking a complete shoot from camera files to MLS-ready delivery

## Executive verdict

Listing Studio has a credible **single-photo edit loop** and an increasingly coherent visual system. The photo-first Task Studio, truthful processing surface, immutable conversational refinements, before/after comparison, QA summary, and version preservation are competitive strengths. The Phase 38–41 visual system should stay frozen.

Listing Studio is not yet a competitive **full-shoot production workflow**. Its current journey begins too late—after files have somehow arrived and been manually organized—and ends without a trustworthy definition of “final.” The central usability gap is not typography, radius, motion, or visual polish. It is the missing operational spine between camera card and deliverable gallery:

1. reliable high-resolution intake;
2. automatic bracket/room organization;
3. safe preset and batch scope;
4. truthful listing-level progress and proofing;
5. explicit final-version approval and MLS delivery.

The known **>10 MB upload failure must precede every further interface change**. A professional shoot cannot enter the product reliably, and the current client sends every selected file in one multipart request with no preflight size disclosure, per-file queue, resume, or retry. A friendlier error alone would leave the product unusable for the primary workflow. The next phase should replace the transport and expose per-file truth; it should not be another cosmetic sweep.

The current interface should therefore be handled with a **split freeze**:

- Keep the Phase 38–41 visual tokens, typography, radii, animation restraint, material language, and staging-photo curation frozen.
- Reopen only the intake, organization, batch-scope, proofing/status, and delivery interactions where this audit found observable task failure or unsafe ambiguity.

## Audit method and evidence confidence

This audit used four evidence classes:

| Mark | Evidence | How it is used |
|---|---|---|
| **O** | Observed in a live browser workflow | Highest confidence. Listing Studio production/public and authenticated local surfaces were exercised directly. Public competitor flows were exercised where no paid action or account was required. |
| **D** | Current official documentation/help/API | Used for capabilities, exact task steps, limits, states, and recovery behavior. |
| **P** | Current official product page or public demo | Used for workflow claims that could not be independently completed without an account, credits, or a generation. Labeled as claimed, not proven. |
| **G** | Account-, plan-, credit-, or payment-gated | The behavior was not guessed. The matrix says when the end-to-end UI could not be observed. |

No paid accounts were created, no credits were purchased, and no paid generations were submitted. Click counts exclude sign-in, payment, the operating-system file chooser itself, text-entry keystrokes, and optional inspection gestures unless noted. “Decision” means a required choice that changes output or scope; a prefilled value that can be accepted is listed as review load rather than a required decision.

An independent senior UX-research/product-design agent ran the direct-product pass separately from the Listing Studio and adjacent-product audit. Its product-by-product evidence, interaction counts, and recommendations were then reconciled against the primary sources and live observations in this document. It was explicitly assigned workflow research rather than a visual-style review.

Important scope caveat: the five direct products are not identical. BoxBrownie is a human editing service, Autoenhance is a shoot-scale enhancement system, ApplyDesign and Virtual Staging AI are staging specialists, and REimagineHome now spans individual generative redesign plus a claimed full-listing workflow. The comparison asks what each teaches Listing Studio, not which has the longest feature list.

## Current Listing Studio journey map

Observed on production at [listing-studio-three.vercel.app](https://listing-studio-three.vercel.app) and in the authenticated local product on 2026-09-01. Production public home and authentication boundaries loaded correctly; the complete signed-in journey was inspected locally on the pinned port 3000 using the existing `11689 Elam Dr`, `123 Smith Street`, and empty `123 Main Street` listings.

```text
Dashboard
  └─ open/create listing
      └─ Upload photos (one multipart request for the entire selection)
          ├─ success → one shared tray; most organization is manual room tagging
          └─ >10 MB request → body truncation → generic “Upload failed — try again”
              (no per-file diagnosis, resume, or partial recovery)

Photo tray
  ├─ click image → single-photo Task Studio
  └─ click each corner + → ordered batch → Edit N photos
      └─ task outcome → contextual options → optional edit chain → output size → Start
          └─ exact result workspace
              ├─ source + truthful Preparing / Editing / Ready / Needs attention
              ├─ before/after
              ├─ Download
              ├─ Refine → immutable new version
              ├─ Versions + QA + edit details
              └─ Activity → listing history → “Download ready images” ZIP
```

### What works now

- **O — Single-photo orientation is clear.** Clicking a photo opens a focused studio; task-first outcome selection avoids forcing prompt-writing.
- **O — Stage has useful defaults without hiding the important choices.** Room, style, furnishing level, and focal showcase are visible; a known room tag pre-fills the canonical room type.
- **O — Edit chaining is real and inspectable.** “Add another edit” exposes supported sequential outcomes rather than pretending a single generic transformation can do everything safely.
- **O — Submission continuity is strong.** Starting an edit routes to the exact result workspace instead of dropping the user back into a feed.
- **O — Progress language is human and truthful at the single-output level.** The source remains visible and the user is told the edit continues after leaving.
- **O — Review and rework preserve trust.** Before/after is immediate, refinements make a new version, selecting an older version changes the review target, and QA is summarized rather than dumped into the main canvas.
- **O — Mobile containment is sound.** The listing, batch studio, and result surfaces had no document-level horizontal overflow at a phone-sized viewport.

### Where the journey breaks

| Stage | Observed current behavior | Consequence for a power user |
|---|---|---|
| Full-shoot upload | All selected files are appended to one `FormData` request. There is no visible size limit, total-size estimate, per-file row, progress, pause, resume, or retry. The known Next request truncation occurs before `formData()` can parse a >10 MB request. | The primary workflow can fail before the product begins. The user cannot tell which file caused it or recover without selecting everything again. |
| Organization | A seven-photo listing showed six untagged photos. Room tags are assigned one photo at a time. HDR auto-detection is not exposed in the intake flow. | Shoot organization becomes manual clerical work; bracket sets can be processed incorrectly or ignored. |
| Listing counts | The dashboard showed `11689 Elam Dr` as six photos while the Photos tray showed one; floor-plan attachments are included in the dashboard count but excluded from the tray. | The dashboard does not answer the operational question “how many listing photos are here?” |
| Presets | “Saved edits” offers Apply last edit and one per-listing default. The default is unnamed, stored only in browser `localStorage`, gives little save confirmation, and cannot be selected during upload. | No reusable client/property/shoot profile, no cross-device persistence, no discoverable preset library, and no reliable batch setup before files start processing. |
| Batch selection | Each photo requires an individual corner click. There is no Select all, Shift-range, drag selection, room-group selection, or automatic scope preview. | A 30-photo shoot needs 30 selection clicks before configuration. |
| Batch safety | In the live two-photo batch, both source photos were untagged yet Stage silently defaulted the shared Room type to **Living Room**. The same setting applies to every selected photo. | A mixed-room batch can be staged under the wrong room type with no blocking warning or per-room split. This is an output-integrity defect, not taste. |
| Plain language in batch | The batch studio says the user can describe the result, while the text-box placeholder says chat works one photo at a time. | The surface advertises an unavailable path and forces the user to discover the restriction from placeholder copy. |
| Progress | Output-level status is good, but there is no shoot-level queue with `uploaded / grouped / queued / editing / review / approved / failed` counts or per-file retry. | The operator cannot answer “Is the listing ready?” without opening Activity and individual outputs. |
| Review | Results are opened one at a time. There is no contact-sheet proofing pass, approve/reject/final flag, issue filter, or keyboard review queue across a shoot. | Review cost grows linearly and there is no explicit completion gate. |
| Versions | Version preservation is strong, but names are generic (`Original edit`, `Revision 1`, `Revision 2`) and there is no side-by-side variation comparison or final-version marker. | The system remembers history but not the operator’s decision. |
| Delivery | The listing ZIP route takes the latest version of **every completed FileGroup across every job**, whether or not it was approved, and names files from an internal ID prefix. | Abandoned experiments can be delivered, selected older versions cannot be the final, and filenames are not MLS/client friendly. |
| Empty/recovery | Empty Photos says “Upload some above” but does not state formats, limits, expected shoot behavior, or give a CTA in the empty region. Upload exceptions collapse to one generic retry message. | The first-run experience does not build confidence about professional inputs or recovery. |

## Direct-competitor comparison matrix

### Evidence-aware journey comparison

| Journey stage | BoxBrownie | Autoenhance.ai | ApplyDesign | Virtual Staging AI | REimagineHome |
|---|---|---|---|---|---|
| 1. Full-shoot upload and large files | **D/G:** Dashboard job upload supports multiple file groups and does not publish a precise maximum; current guidance recommends contacting support above 20 images. Human-service job structure handles many outputs. | **O/D:** Files or folders by device/drag-and-drop plus Dropbox; JPEG, WebP, AVIF, HEIC, TIFF and major RAW formats. Upload is an order, not a one-photo modal. User must keep the page open until upload finishes. | **D/G:** Platform/API accepts one or more 2D or 360 images under a property and can save unfinished upload progress. Consumer staging remains image-led; no public resumable-transfer contract found. | **O/D/G:** The observed consumer journey is singular—upload one image, then configure it. API accepts a direct file or URL and supports high concurrency, but that is not an observed end-user shoot queue. | **P/D:** Official Smart Media Module claims up to 50 listing photos in one pass. FAQ states PNG/JPEG/WebP/HEIC/HEIF up to 25 MB per photo. This is the closest direct evidence against Listing Studio’s 10 MB failure. |
| 2. Sorting, brackets, rooms, organization | **D:** Job/FileGroup organization and manual service-specific choices; no automatic HDR or room sorting found in the end-user evidence. | **D:** Best in class here. Order name, auto-detect-and-merge HDR by metadata plus visual similarity, mixed single/bracket uploads, fixed 2–10 bracket option, up to nine brackets, and parallel processing. No room classifier documented. | **P/D:** Property groups images. Multi-Angle Consistency asks the user to mark photos as the same room; room type is explicit. No bracket detection found. | **D:** Room type is a required staging input. No automatic room grouping or bracket handling found in the consumer flow. | **P:** Claims automatic room sorting, compliance issue flags, enhancement buckets, and a recommended improvement plan for a full listing. MLS compliance still requires human review. |
| 3. Choosing an editing outcome | **P/D:** Service-first: enhancement, dusk, staging, removal, renovation, plans, and others, followed by service-specific options. | **O/D:** Enhancement is the primary outcome; a visible settings rail controls sky, perspective, privacy, lens, windows, TV, fire, photographer, and grass. | **P:** Staging-first; automatic staging, furniture removal, 2D/360, and manual drag/drop refinement. | **D:** Select room type, furniture style, and declutter mode, then generate. Narrower and simpler than Listing Studio. | **P/D:** Upload, choose a design goal, then guide by style or plain-language intent. Full-listing module proposes fixes before execution. |
| 4. Presets / saved preferences | **D:** Account sample images and detailed job options can be reused; API supports pre-uploaded samples. Named end-user workflow presets were not verified. | **O/D:** Strongest direct benchmark. Warm/Vivid/Natural plus named custom presets combining AI and finetune settings; presets can be defaults, selected at upload, copied to selected images, used for a client, and addressed by API ID. | **D:** Design styles, curated furniture bundles, and staging specifications; saved user/client presets were not found. | **D:** Room/style selections and cloud projects; saved custom preset behavior was not found. | **P:** References and natural-language intent are reusable inputs, but a named account-wide/client preset system was not verified. |
| 5. Batch selection and application | **D:** A job can contain multiple outputs and options, but the end-user selection mechanics are account-gated. | **D:** Order-wide upload settings, upload-time presets, Copy → selected photos, Select all, per-image overrides, parallel processing, and select-or-all export. | **P/D:** Multiple uploads and automatic staging exist. Same-room angles are explicitly linked and share a style/layout. | **D/G:** Web evidence is still per-image; API can run concurrently but does not prove a consumer batch workspace. | **P:** Claims Fix All or per-photo fine-tuning across as many as 50 photos, then review and bulk delivery. |
| 6. Combining edits | **D:** Staging jobs can include enhancement and item-removal options; costs and instructions are explicit. | **D:** AI settings and finetune settings combine into one preset; this is a parameter stack, not a generative sequential chain. | **P/D:** Furniture removal can precede staging; manual drag/drop revisions can follow. | **D:** Declutter-only or declutter-plus-stage in one render; the API can return both empty and staged outputs. | **P/D:** Conversational steps build on the prior result across staging, redesign, removal, landscaping, and related goals. |
| 7. Progress and status | **D:** Dashboard exposes job status and ETA; the norm is about 24 hours and virtual staging can be longer. The service is truthful but slow. | **D:** Excellent operational truth: upload queue, HDR grouping delay, per-image `Processing` thumbnails, parallel completion, immediate review of finished images, and safe leave-page guidance after upload. | **D:** Property/Progress surfaces and API expose `in_progress / completed / failed`, render lists, email completion, and webhooks. Consumer generation was not run. | **D:** API supports immediate render ID plus queued/rendering/done/error, numeric progress, or a blocking response; consumer claim is seconds. Detailed recovery UI was not observed without a generation. | **P/D:** Claims 2–5 minute full-listing turnaround and 6–10 second single renders, with rare 3–4 minute load cases. Smart Media explicitly distinguishes recommendations, processing, `Review Pending`, and `Listing Ready`; transfer controls were not independently observed. |
| 8. Before/after review | **P:** Before/after assets and completed-job review are central, but the signed-in review UI was gated. | **D:** Compare button or `\`, zoom/pan, arrow-key traversal, filmstrip thumbnails, and grid return. Review can begin before the order finishes. | **P:** Before/after plus an on-the-spot visual editor. Multi-angle result consistency is part of the promise. | **D/P:** Online preview and multiple staged renders; public demos show before/after. Exact proofing controls were gated. | **P:** Original/result comparison, side-by-side directions, notes, and a `Review Pending → Listing Ready` full-listing concept. |
| 9. Regeneration / conversational rework / variations | **D:** Rework is a formal request against a completed file with a comment and optional references; public service pages promise changes within the revision window. | **D:** Change AI settings or finetune, Apply to re-enhance, or Copy/Paste to a batch. Re-download does not charge again for the same previously downloaded image. Text feedback trains the model but is not conversational editing. | **P/D:** Immediate manual design customization; every render is retrievable by API. Natural-language rework was not found. | **D:** Unlimited rerenders are marketed; API variations produce different furniture arrangements for the same room/style. No conversational correction loop found. | **P/D:** Strong conversational companion: follow-up instructions build on the last edit, references can guide a specific change, and the user can regenerate or re-upload. |
| 10. Version history | **D:** Rework preserves a completed-job lineage in the service/API, but a user-facing branch/compare model was not verified. | **D:** Re-enhance produces a new version; documentation emphasizes iteration, but a rich named version-history panel was not found in the current help set. | **D:** API returns all renders with creation date and status. Consumer compare/branch semantics were not verified. | **D:** Cloud storage and multiple renders exist; explicit version lineage, naming, and branching were not found. | **P:** “Every edit builds on the last” and projects preserve designs, but formal version naming, branching, and final-version selection were not verified. |
| 11. Download, delivery, MLS readiness | **D:** Original, under-10 MB, and under-5 MB output choices align to portals; files return through the job. | **D:** Strongest direct export contract: JPEG/PNG/WebP/AVIF/JXL, 40–100% quality, original or address-plus-sequence filenames, selected or whole-order export, original/non-staged companions, watermark, AI disclosure marker, draggable output order, and up to 6K. | **P:** Download staged/empty/360 results. No listing-level MLS package or approval gate found. | **D:** High-resolution cloud downloads; free output is watermarked and paid output removes it. No MLS profile or shoot ZIP found. | **P:** Claims high-resolution room-sorted bulk download and market-ready galleries; FAQ notes that compliance still needs user review. |
| 12. Mobile behavior | **P:** SnapSnapSnap iPhone capture is promoted; the full job dashboard mobile workflow was not observed. | **G/D:** Web workflow is documented; no native mobile shoot app was found in the reviewed official sources. | **G:** Responsive web/360 claims only; no native mobile workflow found. | **P:** Browser-first upload is promoted; a current native-app workflow was not verified. | **D:** Current Android app supports upload, generate, save, refine, share, and reporting an output; iOS availability is less clear in the reviewed evidence. |
| 13. Empty, loading, error, recovery | **D:** Human support, dashboard ETA, and formal revision paths are strengths; machine-level partial upload recovery was not found. | **D:** Clear queued/Processing states and troubleshooting: keep page open for upload; if no thumbnails appear after ten minutes, contact support and start a new order. Weakness: images expire after 30 days without warning. | **D:** Uploads can move to a Progress surface; API has explicit invalid-parameter, property, credit, and failed-render states. Several official consumer recoveries still reduce to refresh, rerender, or contact chat. | **D:** Mask editing handles furniture-removal misses; ordinary staging can rerender; API exposes asynchronous error/status and a timeout workaround. | **D/P:** FAQ discloses timing/load expectations and recommends companion correction or re-upload. Smart Media claims compliance flags; exact failed-item retry controls were not observed. |

### Direct-product takeaways

- **Autoenhance is the operational benchmark.** It treats the unit of work as a named property order, makes HDR grouping an intake decision, lets presets apply before processing, tells the truth per image, supports review while the rest finish, and exports with address-based names and disclosure variants.
- **REimagineHome is the strategic threat.** Its current official full-listing story matches the journey Listing Studio is missing: up to 50 files, room sorting, compliance buckets, a plan, Fix All/per-photo controls, review state, and a room-sorted ZIP. Because much of this was only publicly demonstrable rather than hands-on, copy the workflow logic—not unverified performance claims.
- **ApplyDesign owns the same-room consistency concept.** Explicitly linking several angles before choosing one style is more honest and more useful than applying a room default to an arbitrary mixed batch.
- **Virtual Staging AI wins on narrow speed, not shoot operations.** Its single-room upload → room → style → variants loop is a useful simplicity reference but a poor architecture for a 30–50 photo property.
- **BoxBrownie remains the service/revision benchmark.** It validates job-level options, reference images, portal sizes, and formal rework, but its human handoff and long turnaround are the behavior Listing Studio exists to remove.

## Adjacent-product pattern matrix

| Journey stage | Adobe Lightroom | Frame.io | Canva | Photoroom |
|---|---|---|---|---|
| 1. Full-shoot upload / large files | **D:** Local-first access avoids mandatory cloud import; Cloud import supports album assignment and sync. Professional RAW workflow is native. | **D:** Drag files or whole folder structures; centralized upload sheet can pause, resume, and cancel. Drive/Transfer adds resumable large-batch transfer, verification, and logs. | **D:** Multiple media upload with explicit limits; supported images are under 50 MB and 250M pixels. | **O/D:** Batch is a first-class top-level mode; Web imports images or a folder. Batch export is paid. |
| 2. Sorting / brackets / rooms | **D:** Albums, folders, metadata, flags, ratings, keywords, smart albums, time/visual-similarity auto-stacks, and HDR/panorama merge. No room model. | **D:** Project/folder hierarchy and preserved folder structures; no domain room or bracket recognition. | **D:** Projects/folders/pages; no shoot or bracket semantics. | **D:** Batch grid and manual selection; no property/room/bracket model. |
| 3. Choosing an outcome | **D:** Tool/preset-oriented photo editing. | **N/A:** Review/delivery product, not the edit engine. | **D:** Outcome/tool/editor sprawl; templates often define the task. | **O/D:** Home exposes named outcomes plus Batch; batch sidebar exposes concrete transformations. |
| 4. Presets / saved preferences | **D:** Named presets/profiles, including custom/third-party, sync across desktop and mobile. | **D:** Saved share settings and metadata schemas, not image-edit presets. | **D:** Templates and Brand Kit standardize output. | **D:** Named team/custom templates can be saved from a batch image and reused in later batches. |
| 5. Batch selection / application | **D:** Copy chosen settings and paste to one or many; Classic adds Auto Sync. | **D:** Multi-select assets/folders for transfer, review, metadata, and delivery. | **D:** Page and asset multi-select exists, but image-edit batch is less coherent than Photoroom. | **D:** Select individual, Cmd/Ctrl group, Shift range, drag range, or Select all. No selection means “apply to entire batch,” which is fast but dangerously implicit. |
| 6. Combining edits | **D:** Non-destructive adjustments compose in one state. | **N/A:** Versions and comments surround externally produced edits. | **D:** Layers/effects/tools compose freely; scope is too broad for a focused property editor. | **D:** Template, resize, position, background, shadows, AI tools, then individual editor; on return choose one image or Apply to all. |
| 7. Progress / status | **D:** Local edits are immediate; cloud sync is background. | **D:** Best benchmark: batch and per-file transfer progress, pause/resume/cancel/reorder, completed/failed/verified/unverified status, desktop notifications, and logs. | **D:** Upload/download processing and reconnect states exist; recovery documentation is detailed. | **D:** Batch processes a set but public docs focus more on editing than a durable per-file queue. |
| 8. Before/after review | **D:** Before/after and versions are part of the editing model. | **D:** Side-by-side version compare for images/video/PDF, zoom, comments, and keyboard shortcuts. | **D:** Undo/history and editor preview; not purpose-built photographic proofing. | **D:** Grid overview plus individual editor Next/Previous; no dedicated before/after proofing contract found. |
| 9. Rework / variations | **D:** Continue non-destructively, copy settings, or make a named version. | **D:** Comments and approval states drive a new externally uploaded version. | **D:** Continue editing, duplicate, restore history, or use AI alternatives. | **D:** Edit one batch image, return, then apply recent edits to only that image or all; AI tools generate alternate results. |
| 10. Version history | **D:** Named and automatically saved versions; hover preview; export any preferred version. | **D:** Version stacks, reorder/manage, previous version access, and two-version comparison. | **D:** Autosave/version history exists on eligible plans; its general-design model is broader than Listing Studio needs. | **D:** Critical negative: Batch images are not saved as designs; they must be downloaded and re-uploaded to preserve them. |
| 11. Download / delivery | **D:** Explicit export settings and export from any named/auto version. | **D:** Choose original/proxy quality, selected assets/folders, permissions, review links, and approval-controlled handoff. | **D:** File type, page selection, quality/size/compression options, and detailed failure recovery. | **D:** Download batch with name and file format. Mobile can save to gallery or share. |
| 12. Mobile | **D:** Mobile editor with synced presets/profiles and cloud albums. | **D:** iOS upload, review, comment, and offline playback; some background-download limits are disclosed. | **D:** Full mobile editor and mobile-specific paths. | **D:** iOS and Android Batch are documented, including export/share. |
| 13. Empty/loading/error/recovery | **D:** Mature local/cloud recovery and non-destructive originals. | **D:** Per-file transfer logs and explanations; resumable transfers lose no progress after interruption. | **D:** Excellent help-level recovery: explicit upload limits, corrupted-element isolation, wait-for-upload, re-upload, smaller export batches, reconnect/save checks. | **D:** Clear plan gating and workflow limitations, but Batch’s “not saved as designs” behavior creates its own recovery risk. |

### Adjacent patterns worth carrying forward

- **From Lightroom:** preserve a source, make edits non-destructive, let the user name versions, and copy only selected settings—not an opaque whole configuration—across a chosen scope.
- **From Frame.io:** separate production status from approval status. `Ready` means processing finished; `Approved final` means the operator chose a deliverable. Transfers need item-level truth, resume, cancellation, and a failure log.
- **From Canva:** disclose format and file limits before selection and provide specific recovery actions. Do not imitate the everything-editor information architecture.
- **From Photoroom:** make Batch a first-class workspace, support Select all/range/drag, allow an individual exception, and ask explicitly whether a change applies to one or all. Do not copy the implicit “nothing selected means everything” scope or disposable batch history.

## Click count, decision count, and major friction

### Counting model

- Counts begin at the product’s relevant project/listing/order workspace.
- `actions / decisions` means minimum visible app actions followed by required output/scope decisions.
- File-chooser navigation, typing, login, payment, processing wait, optional compare/zoom, and paid download confirmation are excluded.
- `N` is the number of photos selected individually. Counts derived only from a marketing-stage diagram are marked **claimed**; account-gated paths are not assigned false precision.

| Product and key journey | Minimum actions / decisions | Major friction or advantage |
|---|---:|---|
| **Listing Studio — upload a shoot** | `2 / 1` (Upload photos, choose files) | Action count is low but misleading: the entire set is one request, >10 MB can truncate it, and there is no item queue or recovery. |
| **Listing Studio — single Stage with defaults** | `3 / 0 + review 4 defaults` (photo, Stage, Start) | Fast when the room tag is trustworthy. Room/style/level/showcase still require mental verification. |
| **Listing Studio — Stage N tray-selected photos** | `N + 3 / 0 + review 4 shared defaults` | Linear selection cost; no Select all/range; shared Living Room default can be wrong for untagged or mixed-room batches. |
| **Listing Studio — refine and choose a version** | `2 / 1` to type + Create; `1 / 1` to select a version | Strong immutable behavior; weak version naming and no final flag or side-by-side variation compare. |
| **Listing Studio — ZIP delivery** | `2 / 0` (Activity, Download ready images) | Fast but unsafe: scope is every completed FileGroup’s latest version, not approved finals; filenames are internal IDs. |
| **BoxBrownie — submit a service job** | `~4+ / 3+` documented minimum | Service, files, job options/instructions, and submit are clear; exact dashboard clicks are gated and human turnaround remains the primary cost. |
| **Autoenhance — new property order with defaults** | `~4 / 2` (add files/folder, grouping mode, order name, Enhance) | N-independent intake; defaults reduce decisions while the order/grouping model remains explicit. Upload must finish before closing the page. |
| **Autoenhance — apply a preset to a processed batch** | `3 + selection / 1` (Copy, select/Select all, Paste) | Clear scope and reusable named presets; copy/paste is a familiar but indirect command model. |
| **Autoenhance — export an order** | `2–3 / 2+` (Export, format/quality/name/disclosure, confirm) | More decisions than Listing Studio, but every decision is delivery-relevant and scope is visible. |
| **ApplyDesign — consistent same-room staging** | `4 + one link action per additional angle / 2` **claimed** | Upload angles, choose room, mark same-room, choose style/stage. More setup, but the consistency promise is honest. |
| **Virtual Staging AI — one render** | `~4 / 2` (upload, room, style, render) | Extremely short; becomes repetitive and unstructured across a full shoot. |
| **REimagineHome — full listing** | `~6 workflow stages / not independently countable` **claimed** | Upload → sort/flag → recommended plan → Fix All/per-photo → review → room-sorted download. Strong model; exact interactions remain gated. |
| **Lightroom — copy chosen settings to a batch** | `3 + selection / 1+` (Copy/Choose settings, select targets, Paste) | Powerful explicit settings scope; assumes expert familiarity. |
| **Frame.io — upload a folder** | `1–2 / 1` (drag folder, choose destination if needed) | Central queue supplies the truth afterward: pause/resume/cancel, per-file state, verification, log. |
| **Frame.io — compare two versions** | `~3 / 2` (open stack, Compare, choose left/right) | Comparison is explicit and high-confidence; producing the next version happens elsewhere. |
| **Photoroom — create and template a batch** | `~5 / 2` (Batch, import folder/images, Upload, Templates, template) | Strong N-independent setup and range selection; paid export and non-persistent batch outputs are material weaknesses. |

### Decision-load interpretation

Listing Studio’s problem is not too many visible decisions. Phase 38–41 already reduced that well. The problem is that **high-risk scope decisions are absent or implicit**:

- Which files actually uploaded?
- Which exposures belong to one HDR?
- Which photos show the same room?
- Which preset applies at listing, room, selected-photo, or one-photo scope?
- Which result version is approved?
- Which approved finals belong in the MLS package?

The next UX work should add those decisions at the moment they prevent expensive mistakes, while leaving cosmetic choice density alone.

## Steal / Adapt / Reject

### Steal

| Pattern | Source | Listing Studio use |
|---|---|---|
| Named address-based order with folder/device/cloud intake | Autoenhance | Treat the listing as the durable shoot order. Preserve folder/file names and display accepted formats before selection. |
| Automatic HDR grouping with an override | Autoenhance + Lightroom | Default to metadata/visual bracket grouping; show each stack and allow split/merge before processing. |
| Upload queue with per-file progress, pause/resume/cancel/retry, and logs | Frame.io | Use a direct-to-storage/resumable transport and show item truth. Partial success must remain usable. |
| Named custom presets selectable during intake and copyable to selected photos | Autoenhance + Lightroom | Persist named presets in the account, support listing default and client/profile defaults, and expose settings included in the preset. |
| Select all, Shift/range, drag-range, and explicit one-vs-all apply | Photoroom | Replace N individual clicks and prevent accidental global scope. |
| Review can begin before the whole batch finishes | Autoenhance | Open finished outputs immediately while keeping aggregate `N of M` truth. |
| Approval is separate from processing completion | Frame.io | Add `Review pending`, `Approved final`, and `Needs changes`; only approved versions enter delivery. |
| Named/auto versions with export from the chosen version | Lightroom | Keep immutable versions but add meaningful names, source lineage, and a final marker. |
| Original/address/sequence filename options and disclosure companion outputs | Autoenhance | Export `01-address-room.jpg`, retain original names as an option, and make AI/virtual-staging disclosure explicit. |

### Adapt

| Pattern | Adaptation needed |
|---|---|
| REimagineHome full-listing Smart Media plan | Use the flow—sort, flag, recommend, Fix All/per-photo, review, deliver—but keep Listing Studio’s stricter geometry, provider transparency, QA, and user approval. Treat the public performance claim as unverified until tested. |
| ApplyDesign multi-angle consistency | Add a first-class same-room group and use shared floor-plan/reference grounding. Do not promise identical furniture until the generation layer proves it. A visible “same room, consistency requested” contract is still valuable. |
| BoxBrownie job options and sample library | Keep structured service/edit options and reusable references, but execute immediately and conversationally rather than as a human ticket. |
| Frame.io review queue | Borrow contact-sheet proofing, status, keyboard traversal, and approval. Omit team roles, threaded stakeholder workflows, and enterprise permissions for this single-user product. |
| Lightroom copy settings | Let the operator choose which settings travel—enhancement, sky, room/style, output, compliance—while generative instructions remain explicit and inspectable. |
| Canva upload guidance | Put limits, formats, and recovery in the intake itself, not in a help center. Use Canva’s specificity without copying its general-purpose editor sprawl. |

### Reject

- **Do not copy credit-first UX.** Prices, quotas, upgrade prompts, and watermark gates should not dominate a self-hosted single-user production flow.
- **Do not copy “nothing selected means everything.”** Autoenhance and Photoroom use this shortcut in places; Listing Studio should always show the exact scope before a generative or delivery action.
- **Do not copy one-photo-at-a-time staging as the product architecture.** Virtual Staging AI’s loop is fast for a demo and expensive for a complete property.
- **Do not copy a 24–48 hour ticket handoff.** BoxBrownie’s service form validates options, but the handoff/queue model is what Listing Studio replaces.
- **Do not copy disposable batches.** Photoroom explicitly does not save batch images as designs; Listing Studio’s immutable history is better.
- **Do not copy an everything editor.** Canva’s breadth would weaken the outcome-first photo workflow.
- **Do not copy unverified “Fix All” confidence.** Automatic room/compliance/fix decisions require a visible review gate and per-photo exception path.
- **Do not copy generic AI style carousels as the core preset system.** A power user needs named repeatable production settings, not more decorative categories.
- **Do not copy automatic structural redesign.** Listing Studio’s geometry constraints and QA remain a differentiator.
- **Do not add RAW merely because Autoenhance supports it.** RAW support is evidence of professional intake maturity, not automatic Listing Studio scope; preserve the currently accepted JPG/PNG/WebP/HEIC contract unless Matt separately approves a RAW ingest strategy.

## Ranked Listing Studio gaps

### P0 — blocks or can corrupt the primary workflow

| Rank | Gap | Evidence | Required outcome |
|---:|---|---|---|
| 1 | **Reliable full-shoot intake over 10 MB** | Known body truncation; current one-request upload; competitors accept 25–50 MB images, RAW/folders, or resumable large batches. | Direct/resumable per-file upload with bounded published limits, type/size preflight, individual progress, pause/cancel/retry, partial success, and authenticated listing ownership. This precedes all other interface work. |
| 2 | **Safe batch scope and mixed-room protection** | Live two-photo untagged batch defaulted the entire Stage operation to Living Room; selection costs N clicks. | Select all/range/room groups; visible scope summary; block or split mixed-room Stage batches; allow per-photo/room exceptions before Start. |
| 3 | **Explicit approved final and delivery set** | Current ZIP includes every completed FileGroup’s latest version and uses ID-prefix filenames. | Operator selects one approved version per source photo; delivery includes only approved finals; clear missing/duplicate/warning states; deterministic address/sequence/room or original filenames. |

### P1 — materially slows a complete property

| Rank | Gap | Evidence | Required outcome |
|---:|---|---|---|
| 4 | **Intake organization: HDR stacks, rooms, and shoot counts** | No intake HDR detection; six of seven sample photos untagged; dashboard count includes non-photo attachments. | Show photo count separately from plans; auto-propose HDR groups and room clusters; manual split/merge/retag; never auto-commit uncertain room labels. |
| 5 | **Named, persistent, scoped presets** | Only Apply last and an unnamed per-listing `localStorage` default. | Account-level named presets, optional client/property defaults, upload-time selection, included-setting preview, listing/room/selection scope, cloud persistence. |
| 6 | **Listing-level progress truth and recovery** | Strong result-level truth but no durable shoot queue or per-file upload/retry state. | Aggregate counts by upload/group/queue/edit/review/approved/failed; partial review while processing; exact failed item, reason, and retry. |
| 7 | **Contact-sheet result proofing** | Results are reviewed one at a time; no approval/issue filters or end-of-shoot completion gate. | Grid/filmstrip proofing, keyboard next/previous, before/after, approve/needs-change, QA filter, per-room grouping, and `N of M approved`. |
| 8 | **MLS delivery profiles** | Size choices exist, but ZIP scope/names are unsafe and there is no visible package validation. | Named MLS profiles for dimensions/quality/size/disclosure; package preview; estimated file sizes; missing final and QA warning checks; final ZIP manifest. |

### P2 — valuable after the operational spine is proven

| Rank | Gap | Required outcome |
|---:|---|---|
| 9 | Variation comparison and version naming | Compare two generated directions side by side; name versions; mark an approved branch while preserving full lineage. |
| 10 | Conversational batch rework with explicit scope | Allow “apply this correction to these three exteriors” only after showing selected targets and cost; preserve individual exceptions. |
| 11 | Mobile shoot intake | Camera-roll/folder import, background/resumable upload, progress, retry, and light proofing; do not squeeze the full desktop editor onto a phone. |
| 12 | More specific empty/recovery states | Accepted inputs/limits in-place, empty-state upload CTA, filtered-empty recovery, signed-image retry, and named resolution steps for each failure class. |

## Usability problems vs. aesthetic preferences

### Evidence-backed usability problems

- A >10 MB request can fail before parsing.
- One request contains the entire selection and provides no item-level progress or recovery.
- HDR grouping is absent from the main intake.
- Room organization is predominantly one-photo-at-a-time.
- Batch selection is linear and lacks Select all/range/group scope.
- Untagged/mixed batch staging can silently inherit one shared room type.
- Saved preferences are unnamed, browser-local, and unavailable as an intake profile.
- The user cannot see one shoot-level operational status.
- There is no explicit approval state or final-version marker.
- Listing ZIP scope is every completed edit, not approved finals.
- ZIP filenames expose internal IDs rather than delivery order/room/source identity.
- Dashboard and tray photo counts can disagree because attachments are counted differently.

### Aesthetic preferences with insufficient evidence to reopen

- Font choice, weight nuance, letter spacing, and type scale.
- The current 10–18 px radius system.
- Brass/linen color tuning.
- Disclosure animation timing and task-rail motion.
- Staging-thumbnail crop/style curation.
- Whether panels should have slightly more or less shadow/border.
- Minor spacing density in the Stage controls.

Competitors do not present a superior consistent visual direction worth importing wholesale. Several operationally strong products are visually utilitarian. The evidence supports changing workflow semantics and state—not restyling the application.

## Proposed order of future implementation phases

These are recommended sequencing blocks, not approved plans. No phase should be appended until Matt chooses the scope.

1. **Reliable intake foundation.** Direct/resumable per-file storage upload; explicit bounded limits; preflight; queue; retry; partial success. Preserve auth, accepted media, immutable originals, metadata insertion, and room-tag contract.
2. **Shoot intake and organization.** Correct counts; folder/original filename preservation; HDR stack proposal; room-cluster proposal; manual review; no automatic destructive labeling.
3. **Batch scope and presets.** Select all/range/group, same-room grouping, mixed-room guardrails, named persistent presets, upload-time/default application, per-photo overrides.
4. **Progress and proofing.** One listing-level pipeline with aggregate/per-photo status, partial review, contact-sheet QA, keyboard traversal, approve/needs-change, retry.
5. **Finals and MLS delivery.** Approved-version model, package completeness checks, named MLS profiles, deterministic filenames, room/order sorting, manifest, approved-only ZIP.
6. **Variation and conversational rework upgrades.** Side-by-side variations, named branches, approved branch, scoped batch correction.
7. **Mobile intake/proofing and state hardening.** Background-friendly intake, compact status/proofing, offline/interruption recovery, remaining empty/error states.

Dependencies matter: proofing needs durable per-photo states; delivery needs an approved-version model; safe batch needs room/group scope; every one of them depends on reliable intake.

## Freeze decision

**Keep the visual interface frozen. Reopen the workflow shell in a targeted way.**

Evidence justifies reopening only these surfaces:

- Upload entry and queue: the current workflow hard-fails on normal professional inputs.
- Photo tray organization and selection: N-click selection and manual tagging do not scale to a full shoot.
- Batch Task Studio scope: the live mixed/untagged case can select the wrong shared room semantics.
- Listing-level Activity/proofing: `Ready` does not currently mean reviewed or approved.
- Download/delivery: the current ZIP can contain unintended work and cannot name or order finals professionally.

The Task Studio’s visual language, result canvas, typography, radii, colors, motion, and staging previews should not be reopened unless usability testing of one of those targeted workflow phases produces new evidence.

## Primary evidence links

### Listing Studio

- [Production product](https://listing-studio-three.vercel.app)
- Repository evidence: `app/listings/[id]/upload-panel.tsx`, `app/api/upload/route.ts`, `app/listings/[id]/composer.tsx`, `app/listings/[id]/f/[fileGroupId]/file-group-workspace.tsx`, and `app/api/listings/[id]/download-all/route.ts` (inspected at Phase 42 HEAD; application code unchanged).

### Direct products

- BoxBrownie: [current FAQ/workflow/ETA/revisions](https://www.boxbrownie.com/faq?id=1), [getting-started workflow](https://www.boxbrownie.com/b/get-started-with-professional-property-photo-editing-fast), [reusable sample images](https://www.boxbrownie.com/b/how-to-use-sample-images-to-enhance-your-job-submissions), [virtual-staging job/rework/options API](https://www.boxbrownie.com/api/v2/docs/job/virtual-staging), [multi-image photo-editing job API](https://www.boxbrownie.com/api/v2/docs/job/photo-editing)
- Autoenhance.ai: [upload and enhance](https://help.autoenhance.ai/en/articles/11939795-upload-and-enhance-images), [file formats including RAW](https://docs.autoenhance.ai/file-guidelines/formats), [HDR grouping](https://help.autoenhance.ai/en/articles/11969308-how-do-hdr-uploads-work), [presets](https://help.autoenhance.ai/en/articles/12870626-using-presets), [review/re-enhance](https://help.autoenhance.ai/en/articles/11940288-review-and-re-enhance-images), [finetune/batch](https://help.autoenhance.ai/en/articles/11949314-finetuning-images), [download/export](https://help.autoenhance.ai/en/articles/11951676-downloading-images), [large/high-volume API versions](https://docs.autoenhance.ai/api-versions), [retention](https://help.autoenhance.ai/en/articles/10010556-how-long-will-my-images-be-stored)
- ApplyDesign: [auto staging](https://www.applydesign.io/ai-powered-staging), [multi-angle consistency](https://www.applydesign.io/multi-angle-consistency), [multi-image Auto Stage workflow](https://support.applydesign.io/faq/cTFHfmFuAJwN2DoxaTtMPM/how-to-upload-multiple-images-auto-stage/7uNXcZCazFom2QSLsEU4hD), [same-room consistency](https://support.applydesign.io/getting-started/pCqPLoHJvwgwLDLKrr4QmF/auto-staging/tzLi4Tn9AAub534pSoba94), [API endpoints/status/renders](https://docs.applydesign.io/diving-in/5ERdQ4YQd2esoXgHzo9kqU/endpoints/n9ac4tYhUDnLEcZF1P1WPM), [upload recovery](https://support.applydesign.io/faq/cTFHfmFuAJwN2DoxaTtMPM/image-upload-issues/hr52JhnL1SfgRdf4krnrGw), [furniture removal](https://www.applydesign.io/ai-furniture-removal). Some detailed support articles are older; they are official but may not reflect every current UI label.
- Virtual Staging AI: [observed public uploader](https://www.virtualstagingai.app/), [FAQ/recovery](https://www.virtualstagingai.app/faq), [official workflow guide](https://www.virtualstagingai.app/blog/how-to-virtually-stage-your-home), [render API](https://docs.virtualstagingai.app/endpoints), [bulk API endpoints](https://docs.virtualstagingai.app/v2-api/endpoints), [variations/core concepts](https://docs.virtualstagingai.app/v2-api/core-concepts), [known timeout guidance](https://docs.virtualstagingai.app/help-and-support)
- REimagineHome: [official product and Smart Media/full-listing positioning](https://www.reimaginehome.ai/), [exact Smart Media upload-to-ZIP workflow](https://www.reimaginehome.ai/blogs/smart-media-module-for-listing-photos), [FAQ including formats/25 MB/timing/recovery](https://www.reimaginehome.ai/faqs), [reference-photo workflow](https://www.reimaginehome.ai/blogs/reference-photo-home-design), [current Android app](https://play.google.com/store/apps/details?id=ai.reimaginehome.app)

### Adjacent products

- Adobe Lightroom: [import/local/cloud access](https://helpx.adobe.com/lightroom/desktop/add-import-and-capture-photos/access-photos.html), [organization](https://helpx.adobe.com/lightroom/desktop/organize-photos/organize-photos.html), [visual/time auto-stack](https://helpx.adobe.com/lightroom-cc/using/auto-stack.html), [presets/copy settings/versions](https://helpx.adobe.com/lightroom/desktop/edit-photos/edit-photos.html), [HDR merge](https://helpx.adobe.com/lightroom/desktop/edit-photos/hdr-panorama.html)
- Frame.io: [web folder upload and centralized upload sheet](https://help.frame.io/en/articles/9090654-getting-started-how-do-i-upload-media), [resumable transfer queue and logs](https://help.frame.io/en/articles/14501692-how-to-transfer-upload-download-in-frame-io-drive), [version stacks/comparison](https://help.frame.io/en/articles/4431-version-stacking-and-comparison-mode-legacy), [review links and approval states](https://help.frame.io/en/articles/414306-sharing-your-files-and-folders-for-review-legacy)
- Canva: [upload formats and 50 MB image limit](https://www.canva.com/help/upload-formats-requirements/?query=technical+requirement), [download failure/recovery](https://www.canva.com/en_in/help/cant-download-design-or-video-variantb/), [editing/help categories](https://www.canva.com/help/editing-designing/)
- Photoroom: [batch workflow](https://help.photoroom.com/en/articles/14178650-edit-multiple-images-at-once-in-batch-workflow-web-app), [batch selection](https://help.photoroom.com/en/articles/12731927-how-to-select-images-using-the-batch-feature-web-app), [batch templates](https://help.photoroom.com/en/articles/14170256-apply-a-template-to-a-batch-of-images-web-app), [save batch image as template](https://help.photoroom.com/en/articles/13440329-save-batch-images-as-templates-web-app), [batch feature/plan limits](https://help.photoroom.com/en/articles/11784338-what-is-the-batch-feature)

## Approval gate

Phase 42 ends with this document. No application implementation, migration, build, or deployment is part of the phase. Matt’s next decision is which recommended blocks to approve and whether P0 ranks 2 and 3 should be combined with or follow the intake foundation.
