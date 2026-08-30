# IDEAS.md — future work, not committed to PLAN

Ideas land here with enough shape to become PLAN phases later. Nothing here is
scheduled; DECISIONS.md logs why deferred things were deferred.

## Furniture warehouse (Matt, 2026-08-30)

> "drop a URL of a product (furniture, lamp etc) from a store site and it will
> download and bring the picture, the dimensions and everything into a
> 'warehouse' and you can choose the furniture you stage with. In fact, I think
> we should have set pieces of furniture, lamps, rugs etc, where we know
> dimensions, how they look float feel, etc."

Two halves:

1. **URL → warehouse import.** Extends phase 9's URL extraction. Most furniture
   retailers ship JSON-LD `Product` structured data (name, images, price) and
   spec tables with dimensions — parse that instead of guessing from prose.
   Warehouse item = typed sample: category (sofa/lamp/rug/table/bed/decor),
   name, W×D×H, material/colour description, source URL, 1–3 images.
   Schema: extend `sample_images` with metadata jsonb + category, or a new
   `warehouse_items` table with an image per angle.
2. **Stage with known pieces.** Warehouse picker in the staging option form
   (filter by room/category). Selected items feed the job as (a) reference
   images (forces gemini, multi-image input) and (b) compiled prompt language:
   name + dimensions + material per piece, riding the same grounding slot as
   room dims — "place a Sundays Movie Night 84-inch oat bouclé sofa (84 x 38 x
   33 inches) against the long wall" beats "a sofa". Room dims + furniture dims
   together = scale-correct staging, the strongest version of context grounding.
3. **Curated set packs.** House library of known pieces per FURNITURE_STYLE
   (e.g. 8-piece Farmhouse living room pack with dims + look/feel descriptions)
   so staging is consistent across listings and reworks converge ("same sofa,
   different colour"). Style memory (use_count) already ranks favourites.

**Honest constraint to design around:** image-edit models approximate reference
furniture — they render "a close match to this sofa at this scale", never the
exact SKU pixel-perfect. Fidelity is best on gemini multi-ref. Frame the
feature as "stage with pieces like these", not product-exact compositing.
Getting exact-product staging would need 3D assets + a render pipeline — out of
scope per CLAUDE.md (no CGI renders).

**Cheap first slice:** import route (JSON-LD parse + dims regex on spec tables)
→ warehouse grid page → staging picker chips → prompt slot. No new provider
work; rides existing refs + grounding.

## Agent branding + marketing suite (Matt, 2026-08-30)

> "find way to add agent branding, pic templates for reels, tik toks etc.
> Include trending canva templates, and then the entire marketing suite,
> presentation, flyers, emails, etc."

The arc: today the app produces finished *photos*; this turns them into
finished *marketing* — the listing goes in, the agent's whole promo kit comes
out. Pieces, roughly in build order:

1. **Agent brand kit** (small, unlocks everything else): per-account profile —
   logo, headshot, name/phone/brokerage, brand colours, font choice. One table
   + settings page. Everything downstream reads it.
2. **Branded reel/TikTok templates.** The reel renderer already composites a
   Darkroom caption overlay via sharp SVG — templates are alternate overlay
   designs (agent logo bug, headshot lower-third, price banner, "JUST LISTED"
   intro card, outro CTA card with contact info). Ken Burns pipeline unchanged;
   9:16 TikTok/Reels already supported. Cheapest high-impact slice.
3. **Pic templates / social cards**: photo + price + beds/baths + branding →
   static Instagram/Facebook post images (sharp compositing, same machinery as
   the watermark pill and plan bands). Story + square + landscape crops.
4. **Trending Canva templates**: Canva has a Connect API (design import/export,
   brand templates) — integration could push listing photos + copy into a
   Canva brand template rather than us re-implementing a design tool. Needs
   API access evaluation; "trending" = curated template list refreshed
   manually or via their API. Alternative: skip Canva, ship our own opinionated
   template set (we already have a design system).
5. **Marketing suite**: listing presentation (PDF/PPTX deck: photos, plan,
   copy, agent bio), print flyer (PDF, QR to tour URL), email blast (HTML
   email with photos + copy + tour/reel links). COPYWRITING (phase 13) already
   generates the words; tours/reels already give link targets — this is
   layout + export plumbing (pdf-lib is already a dependency from plan export).

**Why it fits:** every asset feeds off things the app already produces (photos,
copy, plans, tours, reels) + the one new brand-kit table. It's the "sell the
whole listing kit" move — also the strongest argument for the commercial
direction (per-listing value jumps from ~$2 of edits to a full promo package).

**Open questions:** Canva API vs in-house templates; PPTX vs PDF-only decks;
email sending (export HTML only, or integrate a sender — sending is scope
creep, export-only first).

## Single-shot 360s + photo-derived 3D (Matt, 2026-08-30)

> "can we make 360 panos from a single shot? Could we make our own 3d without
> them uploading 3d?"

Feasibility, honestly assessed:

1. **Single photo → 360 pano: technically yes, compliance-dangerous.**
   Diffusion pano-outpainting models (Skybox AI, PanoDiff-class) take one
   ~70° photo and hallucinate the other ~290°. For a listing that means
   three-quarters of the "room" is invented — fabricated property features,
   the exact thing the MLS compliance checker exists to flag. Viable only as
   a clearly-labeled concept/mood asset, never as a tour of record. Park
   unless a marketing-fluff use case shows up.
2. **Real 3D from normal photos: yes — Gaussian splatting.** 15–50 overlapping
   photos (or a 1-minute phone video walk) → photoreal 3D walkthrough, nothing
   invented. This is what Luma/Polycam sell; hosted APIs exist, and web viewers
   (three.js gsplat) drop into our tour page next to Marzipano. The agent
   already shoots the listing — a capture checklist ("slow pan video of each
   room") is the only new ask. This is the credible "own 3D" path and could
   make VIRTUAL_TOUR work without 360 cameras.
3. **Cheap middle: single-image depth → 2.5D parallax.** Depth-Anything-class
   models give a depth map from one photo; warping yields a dolly/parallax
   move — no invention beyond tiny edge fills. Weak as "3D", strong as
   **Reels Tier B motion** (real camera-move feel for the slideshow renderer
   at pennies). Probably the best effort-to-wow ratio of the three.

**Suggested order if pursued:** 3 (reel motion) → 2 (splat tours) → 1 (probably never).

## Already-deferred (logged in DECISIONS/PROGRESS, indexed here)

- **Reels Tier B** — true image-to-video motion (fal) if Ken Burns feels flat.
- **Preservation-first prompt ordering A/B on qwen** + terser-qwen dialect —
  needs Matt's eyeballs + spend before changing proven templates.
- **Real-ESRGAN upscale for 360 outputs** — if lanczos pano sharpness disappoints.
