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

## Already-deferred (logged in DECISIONS/PROGRESS, indexed here)

- **Reels Tier B** — true image-to-video motion (fal) if Ken Burns feels flat.
- **Preservation-first prompt ordering A/B on qwen** + terser-qwen dialect —
  needs Matt's eyeballs + spend before changing proven templates.
- **Real-ESRGAN upscale for 360 outputs** — if lanczos pano sharpness disappoints.
