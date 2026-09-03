# Listing Studio — pricing research and cost/sensitivity analysis

Date: 2026-09-03 · Read-only pass. No source file changed, no build, no generation, no dev server touched.
Companion grid: `docs/reviews/2026-09-03-pricing-model.csv` (168 rows: 4 segments × 3 usage levels × 7 pricing models × 2 egress modes).
Working script: `/private/tmp/claude-501/.../scratchpad/pricing/model.mjs` (scratch, not in the repo).

**Every number below carries a label.** `[code]` = read out of this repo. `[src]` = external source, cited and dated.
`[est]` = my estimate, with the assumption stated. Nothing unlabelled.

---

## Executive summary

1. Real COGS per delivered photo is **3.5–14.7¢** depending on the chain `[code+est]`. A 40-photo standard shoot costs **$1.84 in API spend** `[est]`, against a BoxBrownie equivalent near $100. The cost side is not the problem.
2. `AVG_GENERATIONS_PER_FILE_GROUP = 2.5` is a flat estimator constant, not what gets billed `[code]`. Billed calls = chain length + retries. It overstates enhance-only by ~1.8× and understates 3-step chains.
3. **The documented upscale step does not exist** `[code]`. There is no fal upscale call anywhere; `upscale` is an allowed `spend_ledger.kind` that is never written. It is not a cost line today, and adding it would raise per-photo COGS ~30–50%.
4. **Egress, not inference, is the swing factor.** As built — no thumbnails, signed URLs re-minted every refresh — one 40-photo shoot moves **~15.6 GB** of Supabase egress `[est from UX review]` versus ~0.14 GB after thumbnails and URL caching. That is a 100× multiplier on the only cost line that scales with *tenants*, not with *edits*.
5. At 200 tenants the difference is **$580/mo of infra versus $3,950/mo** `[est]`. Phase 55 and the deferred thumbnail work are pricing decisions, not polish.
6. **SpendLedger cannot bill anyone yet** `[code]`. No `user_id` column, no quota table, no credits, no Stripe, no rate limit; failed fal calls are billed by fal but never ledgered; interpreter rows carry `job_id = null` and `listing_id = null`, so they are unattributable and invisible to RLS.
7. `MAX_CONCURRENT_RUNNING = 3` is a **global** gate across all `file_groups` `[code]`. It is a hard fleet-wide throughput ceiling — roughly one media-company customer's worth of parallelism, shared by everyone.
8. Market structure `[src]`: human services price per image ($16–$30 staging, $2–$5 enhancement); AI tools price per credit or per month ($0.24–$2.67/image); photographer-facing tools price flat ($20–$72/mo, or per listing at $16–$18). Nobody occupies "conversational, versioned, QA'd, per-listing, photographer-owned".
9. **Recommendation: per-listing subscription with included listings and a staging surcharge** — $39/mo (10 listings), $99/mo (35), $249/mo (100), overage $2–$4/listing by tier, staging/renovation photos $1 each. It matches how photographers already bill, caps the egress risk, and lands 55–90% gross margin across the segments (55–65% at media-company volume once the surcharge is counted).
10. **Fallback: credit packs at ~$0.80/credit blended.** Weakest recommendation is unlimited: $149/mo goes underwater above **~2,890 photos/mo** with fixed egress and **~1,860/mo** as built `[est]` — inside one small media company's real volume.

---

## Part A — Our COGS

### A.0 What the code actually charges for

| Fact | Value | Where |
|---|---|---|
| Provider rates | qwen 2.1¢ · gemini 3.9¢ · kontext 4.0¢ · local 0¢ (stub, throws) | `config/models.ts:10-19` `[code]` |
| Provider choice | refs → gemini; chain length ≥ 3 → kontext; else qwen | `config/models.ts:pickProvider` `[code]` |
| Forced providers | floor-plan redraw + markup → gemini; 360 → qwen | `app/api/jobs/route.ts:364-369` `[code]` |
| Calls per FileGroup | **one fal call per chain step**, sequential | `lib/orchestrator.ts:submitStep`/`completeStep` `[code]` |
| Auto-QA | **one** Claude vision call per delivered version, after the final step only — not per step | `lib/orchestrator.ts:396`, `lib/qa.ts` `[code]` |
| QA skipped for | ideas variants, variation jobs, `FLOOR_PLAN_REDRAW`, `PORTRAIT_RETOUCHING`, all 360 chains | `lib/orchestrator.ts:370-378` `[code]` |
| QA failure | exactly one auto-retry, appended as a `REWORK` step, gated on `qa_retry_count = 0`. Being the new final step, it triggers a **second** QA call | `lib/orchestrator.ts:427-451` `[code]` |
| Generation failure | one auto-retry per step, gated on `retry_count < 1`; a second failure fails the group | `lib/orchestrator.ts:handleGenerationError` `[code]` |
| Upscale | **not implemented.** No fal upscale endpoint, no `image_size` for non-360 chains; `deliver.ts` uses `withoutEnlargement: true` | grep across `lib/ app/ config/`; `docs/reviews/2026-09-03-feature-review.md` §5 `[code]` |
| Interpreter / QA model | Claude Haiku 4.5, $1/MTok in, $5/MTok out | `config/models.ts:INTERPRETER_MODEL` `[code]` |
| Floor-plan text parse | Claude Sonnet 5, $3/$15 per MTok — rare, once per plan | `config/models.ts:VISION_PARSE_MODEL` `[code]` |
| Ideas grid | 4 image calls priced upfront as **one** ledger row | `app/api/jobs/route.ts:413` `[code]` |
| Fal downscale | generations come back at ~1MP (measured 1600×1000 → 1280×800 live) | `DECISIONS.md` 2026-08-29 `[code]` |

**Claude call costs** (system-prompt token counts measured by character count ÷ 4 from `lib/prompts.ts`; image tokens at Anthropic's ~1,600-token cap for ≥1.15MP; output tokens `[est]`):

| Call | Input tok | Output tok | Cost |
|---|---|---|---|
| Auto-QA, plain (`QA_SYSTEM` 543 tok) | ~3,860 | ~150 | **0.46¢** `[est]` |
| Auto-QA, compliance (`COMPLIANCE_QA_SYSTEM` 1,204 tok — staging/reno/dusk) | ~4,600 | ~400 | **0.66¢** `[est]` |
| Interpreter intent parse (`INTERPRETER_SYSTEM` 1,234 tok) | ~1,480 | ~250 | **0.27¢** `[est]` |
| Rework instruction build (`REWORK_SYSTEM` 246 tok) | ~650 | ~150 | **0.14¢** `[est]` |
| Room analysis, 40-photo shoot (4 contact sheets) | ~7,560 | ~3,000 | **2.26¢** `[est]` |
| Copywriting, 8 photos | ~13,970 | ~700 | **1.75¢** `[est]` |

Claude is **1–2% of total COGS**. It is not worth optimising and it is not worth metering separately.

### A.1 Per-edit-type COGS table

Behavioural assumptions, all `[est]` (the repo has no telemetry to measure them from): QA failure rate 20%, generation failure rate 3%, user-initiated rework on 15% of delivered photos.

| Chain | Provider | Rate | Fal steps | + gen-fail retry | + QA retry gen | QA calls | + user rework | **Total ¢/photo** | Fal calls |
|---|---|---|---|---|---|---|---|---|---|
| Enhance only | qwen | 2.1¢ | 2.10 | 0.06 | 0.42 | 0.55 | 0.41 | **3.54¢** | 1.38 |
| Enhance + lights | qwen | 2.1¢ | 4.20 | 0.13 | 0.42 | 0.55 | 0.41 | **5.70¢** | 2.41 |
| Enhance + dusk | qwen | 2.1¢ | 4.20 | 0.13 | 0.42 | 0.79 | 0.44 | **5.97¢** | 2.41 |
| Enhance + item removal | qwen | 2.1¢ | 4.20 | 0.13 | 0.42 | 0.55 | 0.41 | **5.70¢** | 2.41 |
| Enhance + staging (no ref) | qwen | 2.1¢ | 4.20 | 0.13 | 0.42 | 0.79 | 0.44 | **5.97¢** | 2.41 |
| Enhance + staging (style ref or floor-plan grounding) | **gemini** | 3.9¢ | 7.80 | 0.23 | 0.78 | 0.79 | 0.71 | **10.31¢** | 2.41 |
| Enhance + renovation | qwen | 2.1¢ | 4.20 | 0.13 | 0.42 | 0.79 | 0.44 | **5.97¢** | 2.41 |
| Enhance + renovation + landscaping | **kontext** | 4.0¢ | 12.00 | 0.36 | 0.80 | 0.79 | 0.72 | **14.67¢** | 3.44 |

Three cost cliffs worth pricing around, all `[code]`:

- **Attaching any reference image doubles the rate** (2.1¢ → 3.9¢ via `pickProvider`'s `hasRefs` branch). Auto-attached floor-plan grounding triggers it silently — the user never asked for gemini.
- **The third chain step doubles it again** (2.1¢ → 4.0¢ kontext) *and* adds a step, so a 3-step chain is 12¢ of fal against 4.2¢ for a 2-step. Renovation + landscaping is 4× enhance-only.
- **Compliance chains pay more for QA** (0.66¢ vs 0.46¢) because `COMPLIANCE_QA_SYSTEM` adds 660 tokens and 400 output tokens of per-check verdicts.

Blended cost per delivered photo: **4.48¢** on a standard mixed listing, **6.00¢** on a vacant staging-heavy listing `[est]`, using this mix `[est]`:

| Chain | Standard listing | Vacant listing |
|---|---|---|
| Enhance only | 58% | 30% |
| Enhance + lights | 20% | 10% |
| Enhance + dusk | 5% | 5% |
| Enhance + item removal | 12% | — |
| Enhance + staging (no ref / with ref) | 4% | 35% / 18% |
| Enhance + renovation | 1% | 2% |

### A.1b Two ledger bugs that break metered billing

Both `[code]`, both must be fixed before any usage-based price:

1. **Failed calls are billed by fal and not recorded.** The ledger insert sits inside `completeStep`, after the conditional `running → complete` transition (`lib/orchestrator.ts:305-325`). A generation that errors is retried by `handleGenerationError` but never ledgered. SpendLedger therefore under-reports true fal spend by the failure rate — ~3% `[est]`, and 100% of the spend on groups that fail twice and give up.
2. **Interpreter rows are orphaned.** `app/api/interpret/route.ts:26` inserts with no `job_id` (the job does not exist yet) and no `listing_id`. The RLS policy matches on one or the other (`0011_room_proposals.sql:87`), so those rows belong to nobody, are invisible to the owning user, and cannot be attributed to a tenant.

Note also that `BOXBROWNIE_CENTS` (`config/models.ts:34-48`), which drives the dashboard comparison line, is stale in four places against boxbrownie.com/pricing read 2026-09-03 `[src]`: colour change 400 vs live $2.40, item removal 400 (that is the *minor* tier; standard is $8.00), portrait retouching 500 vs live $4.00, floor-plan redraw 2000 vs live $24–$32. The staging ($24.00), dusk ($4.00) and renovation ($176 ceiling) figures are correct.

### A.2 Fixed costs by scale

Rates `[src]`, read 2026-09-03:

- **Vercel Pro** $20/seat/mo + $20 usage credit; 1 TB bandwidth, 1M function invocations, 6,000 build minutes included; overage $0.15/GB, $0.60/M invocations. (vercel.com/pricing via projectcostestimator.com, temps.sh, checked Aug 2026)
- **Supabase Pro** $25/mo per org; 100 GB storage, 250 GB egress, 8 GB database included; overage **$0.021/GB-mo storage**, **$0.09/GB egress**, $0.125/GB-mo database. (supabase.com/pricing via flexprice.io, verified 19 Aug 2026)
- **Cron** free on Vercel Pro; `* * * * *` = 43,200 invocations/mo `[code]` — 4% of the included million.
- **Domain** ~$15/yr = $1.25/mo `[est]`.

Storage model `[est]`: 14 MB per 24MP original (code review measured a 6000×4000 fixture at 13.96 MB), ×1.2 for the canonical normalized HEIC/EXIF derivative (`lib/intake.ts:203-214` `[code]`, assuming 20% HEIC intake), plus 2.3 output objects per photo at 0.35 MB each (model-native ~1MP JPEG q92). **Nothing is ever deleted** — originals are immutable and versions are additive `[code]` — so storage is cumulative. Below assumes 12 months of accumulation and a fleet of solo photographers at 20 shoots/mo × 30 photos.

Egress is split correctly: viewing goes **direct to Supabase** (signed URLs, `lib/storage.ts:40`), only the two download routes stream through Vercel functions `[code]` — and those double-bill, since the route reads the object out of Supabase (egress) then streams it out again (Vercel bandwidth).

| Tenants | Storage @12mo | Supabase egress (fixed) | Vercel egress | Invocations | Vercel | Supabase | **Total/mo** | **Total/mo, egress as built** |
|---|---|---|---|---|---|---|---|---|
| 1 | 124 GB | 2 GB | 2 GB | 0.05M | $20 | $25.50 | **$46.75** | **$46.75** |
| 10 | 1,238 GB | 21 GB | 18 GB | 0.14M | $20 | $48.89 | **$70.14** | **$218.19** |
| 50 | 6,189 GB | 105 GB | 88 GB | 0.52M | $20 | $152.87 | **$174.12** | **$1,004.34** |
| 200 | 24,757 GB | 422 GB | 352 GB | 1.94M | $20 | $558.27 | **$579.52** | **$3,952.41** |

All `[est]` on the volume inputs, `[src]` on the rates. Three things fall out:

- **Compute is free at this scale.** Even 200 tenants only reach 1.94M invocations — $0.56 of overage, absorbed by the $20 credit. Vercel stays at the seat price.
- **Storage is the structural cost, and it compounds.** 200 tenants accrue ~2 TB/month; by month 12 that is $520/mo in storage alone and still climbing. There is no retention policy anywhere in the code `[code]`. A 12-month originals retention rule (or a cold-tier move) is worth more than any inference optimisation.
- **As-built egress is the 7× cost multiplier at 200 tenants.** Derived from the UX review's measured-from-markup finding that the tray re-downloads every full-resolution original on every `router.refresh()` (~350 ms debounce during upload, 5 s poll during edits), with no thumbnails anywhere. My model charges each shoot one full-grid re-download per uploaded photo plus 12 poll refreshes during editing, giving ~15.6 GB per 40-photo shoot against ~0.14 GB fixed.

### A.3 Per-shoot cost

| Shoot | Mix | fal | Claude | **API total** | per photo | Storage | Egress (fixed) | Egress (as built) |
|---|---|---|---|---|---|---|---|---|
| 25 photos | standard | $1.12 | $0.04 | **$1.16** | $0.046 | 0.43 GB | 0.09 GB | 7.0 GB |
| 25 photos | vacant | $1.50 | $0.04 | **$1.54** | $0.062 | 0.43 GB | 0.09 GB | 7.0 GB |
| 40 photos | standard | $1.79 | $0.05 | **$1.84** | $0.046 | 0.69 GB | 0.14 GB | 15.6 GB |
| 40 photos | vacant | $2.40 | $0.05 | **$2.45** | $0.061 | 0.69 GB | 0.14 GB | 15.6 GB |
| 60 photos | standard | $2.69 | $0.06 | **$2.75** | $0.046 | 1.03 GB | 0.21 GB | 32.5 GB |
| 60 photos | vacant | $3.60 | $0.06 | **$3.66** | $0.061 | 1.03 GB | 0.21 GB | 32.5 GB |

All `[est]` on volume, built on `[code]` rates. Per-shoot Claude spend is 3 interpreter calls + one room-analysis pass + one copywriting pass ≈ 4–6¢ — noise.

Loaded, at fixed egress: **$1.85–$1.90 per 40-photo shoot** including storage-year and egress `[est]`. At as-built egress: **$3.30**. The equivalent BoxBrownie order for the same standard mix is roughly $95–$110 `[src, boxbrownie.com/pricing 2026-09-03]`.

---

## Part B — Market

### B.4 Competitor pricing

All figures read 2026-09-03 `[src]`, source noted per row. Where the vendor's own page and third-party reviews disagree, both are shown — that disagreement is itself real (Meltflex noted BoxBrownie's own hero banner and pricing page differing on staging).

| Vendor | Model | Price points | Included | Turnaround | Source |
|---|---|---|---|---|---|
| **BoxBrownie** | Per image, human editors, no subscription | Day-to-dusk **$4.00**; virtual staging **$24.00**; 360 staging $48; item removal $4 minor / $8 standard; colour change $2.40; virtual renovation $24–$176; floor plan $24–$32; 360 enhancement $4; virtual tour $16–$24; portrait $4; background removal $0.80–$4.00. Enhancement widely reported at **$2.00** (not rendered on the page scrape) | Free unlimited revisions | 24 h standard, 48 h staging | boxbrownie.com/pricing; $2/$5/$30 variants in pixelshouters, getstageflow, sofabrain (Aug 2026) |
| **Styldod** | Per image, human designer, volume break | AI tier ~$16/image; **$23 under 8 images, $16 at 8+**; commercial from $24; Matterport $25/hotspot; virtual renovation from $5 | Unlimited free revisions | 24–48 h (near-instant AI tier) | casanovalabs, housingwire, meltflexai (2026) |
| **Virtual Staging AI** | Subscription, credits | **$16/mo → 6 photos ($2.67 ea)** up to **$79/mo → 150 photos ($0.53 ea)**; some sources list $25 entry | Unlimited re-renders per photo | ~10–30 s | virtualstagingai.app/prices via aitoolsbakery (17 Jul 2026), stagehq |
| **REimagine Home** | Subscription, credits | **$14–$19/mo → 30**; $36/mo → 200; $59/mo → 400–500; $99–$119/mo → 900–1,200 | 5 free full-quality designs; 1 revision/credit; shoppable furniture | 15–90 s | reimaginehome official via aitoolsbakery (17 Jul 2026), housingwire, aiandrealtors |
| **Collov AI** | Subscription, credits | **$16–$19/mo → 60 ($0.27–0.32 ea)**; $49/mo → 150; $79/mo → 263; $127/mo → 526 (**$0.24 ea**); overage $0.24 | Free revisions; trial credits watermarked | <60 s | collov.ai/pricing via aitoolsbakery (17 Jul 2026), housingwire |
| **PhotoUp** | Credits + dedicated editor | **$1.50/on-demand credit**, bulk "forever packs" from **$1.10**; AI staging from 3 credits/image; editing $0.50–$9.00/image; dedicated editor **from $7/hour** | Whole marketing suite (tours, sites, flyers) | Same-day to 48 h | photoup.net/learn (2026) |
| **Autoenhance.ai** | Subscription + PAYG, **REST API** | Essential **$29/mo → 50**; Advanced **$109/mo → 250** (4K); Expert **$449/mo → 1,500** (6K); PAYG ~$0.29–$0.75/image, overage to **$0.30** at top tier; 20% off annual; 1-month credit rollover | Preview free, pay only on download. HDR merge, perspective, sky replacement, window pull | Minutes | autoenhance.ai/blog/new-pricing (6 Aug 2026), softwarefinder, forasoft (Jul 2026) |
| **Fotello** | **Per listing**, all-in business suite | **$16/listing** (up to 50 photos, billed as $1,200/mo at 75 listings); **$18/listing** Ultimate (up to 75 photos, 2 twilights + 2 stagings included, $1,350/mo at 75); free tier; Partner custom from 50 listings/mo with API access | Booking, delivery, payments, agent portal, property site, unlimited human revisions | Queue / mixed | fotello.co/pricing (2026-09-03) |
| **Pixlmob** | Marketplace, per image | ~**$1.50/photo** basic (editors often $0.80–$1.50); **$14** virtual staging; "ASAP" rush tier | Direct editor relationships | Editor-dependent | photoup.net/learn, pixelshouters (2026) |
| **HomeJab** | Per shoot (photography marketplace, not an editing tool) | Shoot-level pricing; US baseline **$250–$500** covers ~70% of the market | Shoot + edit + delivery | 24–48 h | plotpane (2026); no public per-image editing rate found |
| **Aftershoot** | Flat monthly, **local processing**, unlimited | Selects **$9.99–$14.99/mo**; Essentials **$19.99–$24.99**; Pro **$39.99–$47.99** ($480/yr); Max **$59.99–$71.99**; extra AI profiles $7/mo | Unlimited culling + editing, no per-image fee, 30-day trial, offline | Local, no queue | aftershoot.com/blog, filterpixel (Mar 2026) |
| **Imagen AI** | Metered per photo + annual volume tiers | PAYG **$0.05/photo** (min $7/mo); **+$0.01/photo per extra AI tool**; annual 18K photos $810/yr, 36K **$127.50/mo**, 72K $2,880/yr | 1,000 free edits; Lightroom style learning; cloud | Cloud queue | filterpixel/imagen-ai-pricing (Apr 2026), aftershoot, narrative.so |
| **Photoroom** | Consumer tiers + separate **API** | App: free (250 exports, watermark), Pro $7.99, Max $26.99, Ultra from $99 (annual $7.50/$20.99/$82.50). **API: Basic $20/mo + $0.02/image; Plus $100/mo + $0.10/image; Partner $0.01/image at 100k+, $1,000/mo min** | E-commerce framing, not real estate | ~350 ms | photoroom pricing via wearview, checkthat.ai, metronome (Feb–May 2026) |

**What the table says.** Three distinct price architectures, and they map to three buyers:

- **Human services** (BoxBrownie, Styldod, PhotoUp editors, Pixlmob) sell **per image at $1.50–$30**. Their ceiling is labour. They are the anchor Matt already beats by 20–500×.
- **AI staging tools** (Virtual Staging AI, REimagine Home, Collov) sell **credit subscriptions at $0.24–$2.67/image**, $14–$127/mo. Single-purpose. Their entry tiers are throwaway-cheap; their per-image rate only materialises at full quota, which almost nobody hits.
- **Photographer tools** (Aftershoot, Imagen, Autoenhance, Fotello) sell **flat monthly or per-listing**. Aftershoot at $40/mo unlimited-local is the psychological anchor for any photographer Matt sells to. Fotello at **$16–$18 per listing including staging and twilight** is the closest direct competitor to what Listing Studio actually does.

**The open position:** nobody sells a conversational, versioned, geometry-constrained, auto-QA'd, per-listing tool to the photographer who owns the client relationship. Fotello is closest but bundles a whole business suite; Autoenhance has the API but no generative staging; Collov has staging but no photographer workflow.

### B.5 Usage frequency

| Segment | Listings/shoots per month | Photos per listing | Basis |
|---|---|---|---|
| **Typical realtor** | **0.4–0.5** | 25 | NAR 2026 Member Profile: median **9 transaction sides in 2025** `[src, nar.realtor]`. Sides include buy-side, so listings ≈ half → ~4–5/yr `[est]` |
| **Top-producing realtor** | **1.5–2** | 28 | ~4% of Realtors close 31+ deals/yr `[src, oliverrealty from NAR data]`. NAR 2026: team-based brokerage specialists median **32 sides**, teams of ~4 `[src]` → ~2.5 listings/mo/agent `[est]` |
| **Solo RE photographer** | **10–35, typ 20** | 30 | ~200 shoots/yr ≈ 17/mo for an established solo `[src, amplifiles]`; one practitioner reports 14–16/week at 4/day `[src, weak — single forum post]`; part-timers 2–15/mo `[src, weak]` |
| **Small RE media company** | **60–200, typ 100** | 35 | 3–6 shooters at 20–35 shoots each `[est]`. Autoenhance sizes its Expert tier at 1,500–10,000 images/mo for "real estate media companies" `[src]`, which brackets 40–280 shoots/mo — consistent |

**Photos per listing** `[src]`: Zillow's listing-performance analysis puts the engagement sweet spot at **22–27 photos** (lens-collective, roomlift). Practitioners deliver 15–25 under 2,000 sq ft, 25–40 at 2,000–4,000, 40–60 over 4,000 (amplifiles, luxurypresence). MLS caps run 25–100 depending on system (CRMLS 100, Bright 50, NWMLS 40, HAR 40).

**Share of photos getting which edit** — this is the weakest data in the report; only the twilight number has a real source.

| Edit | Share of delivered photos | Basis |
|---|---|---|
| Enhancement | ~100% | Baseline; every chain starts here `[est]` |
| Turn on lights | ~20% | Interior subset `[est]` |
| Day-to-dusk | ~5% (1–2 exteriors/listing) | Only **8% of listings** currently use twilight `[src, roomagen]`, but per-shoot it is 1–2 photos when bought |
| Item removal | ~12% | Occupied-listing subset `[est]` |
| Virtual staging | ~4% of a mixed book; **~50% on a vacant listing** | NAR 2025: **21% of sellers' agents stage all homes**, down from 38% in 2017 `[src]`. Vacant listings need 5–8 rooms staged `[src, getstageflow, sofabrain]` |
| Renovation / landscaping | ~1–2% | `[est]` |
| User rework | ~15% of delivered photos | `[est]`, no telemetry |

---

## Part C — Sensitivity analysis

Full grid: **`docs/reviews/2026-09-03-pricing-model.csv`**. COGS per tenant = API spend + attributable infra (12 months of accumulated storage at $0.021/GB-mo + egress at $0.09/GB) + support `[est]` at $2/tenant/mo, $6 for BYO-key tenants.

The seven models tested:

| # | Model | Definition |
|---|---|---|
| 1 | Per-image | $0.75 per delivered edited photo, any chain |
| 2 | Per-edit-type tiered | enhance $0.50 · lights/dusk/removal $1.00 · staging $3.00 · renovation $5.00 |
| 3 | Credit packs | staging = 3 credits, renovation = 5, everything else 1; ~$0.80/credit blended after pack discounts |
| 4 | Subscription + included volume | $29/150 photos · $99/750 · $299/3,000; overage $0.15/photo; customer picks the cheapest tier |
| 5 | Unlimited | $149/mo, no cap |
| 6 | BYO key + software fee | $39/mo; tenant's own fal + Anthropic keys, so API COGS = 0, our storage/egress/support unchanged |
| 7 | Hybrid | $49/mo base + 300 photos included + $0.12/photo over + $1.50 per staged/renovated photo |

### C.6a Typical usage, egress fixed (thumbnails + signed-URL caching shipped)

| Model | Realtor (13 ph/mo) | Top realtor (56) | Solo photographer (600) | Media co (3,500) |
|---|---|---|---|---|
| Per-image $0.75 | $9 rev / 72% GM | $42 / 89% | $450 / **93%** | $2,625 / **93%** |
| Per-edit-type tiered | $10 / 75% | $46 / 90% | $498 / 94% | $2,905 / 94% |
| Credit packs | $11 / 76% | $50 / 90% | $538 / 94% | $3,136 / 94% |
| Subscription + volume | $29 / 91% | $29 / 83% | $97 / 66% | $374 / 52% |
| Unlimited $149 | $149 / 98% | $149 / 97% | $149 / 78% | $149 / **−21%** |
| BYO key $39 | $39 / 85% | $39 / 84% | $39 / 78% | $39 / **43%** |
| Hybrid | $50 / 95% | $52 / 91% | $121 / 73% | $643 / 72% |

### C.6b Same rows, egress as built today (no thumbnails, refresh churn)

| Model | Realtor | Top realtor | Solo photographer | Media co |
|---|---|---|---|---|
| Per-image $0.75 | 69% | 85% | 89% | 89% |
| Subscription + volume | 90% | 78% | **49%** | **23%** |
| Unlimited $149 | 98% | 96% | **67%** | **−94%** |
| BYO key $39 | 84% | 80% | **34%** | **−240%** |
| Hybrid | 94% | 88% | 59% | 55% |

Attributable infra for one solo photographer: **$2.79/mo fixed → $19.65/mo as built**. For one media company: **$9.76 → $126.49**.

### Where unlimited goes underwater `[est]`

| Price | Fixed egress | As-built egress |
|---|---|---|
| $99/mo | above 1,908 photos/mo (~64 shoots) | above 1,229 (~41 shoots) |
| $149/mo | above 2,891 photos/mo (~96 shoots) | above 1,862 (~62 shoots) |
| $199/mo | above 3,875 photos/mo (~129 shoots) | above 2,495 (~83 shoots) |
| $299/mo | above 5,842 photos/mo (~195 shoots) | above 3,762 (~125 shoots) |

A "small RE media company" at typical volume is 100 shoots/mo. **$149 unlimited is already negative there**, and $299 unlimited only clears it if the egress work ships. Unlimited is priced against a customer who does not exist in this market's tail: real estate photography volume has no natural ceiling, and the heaviest 5% of buyers are precisely the ones who will find the plan.

### What BYO key does

**To margin:** it removes the *only* cost line that scales with usage and leaves the two that scale with tenants. Revenue goes flat, COGS keeps climbing. BYO key at $39/mo is 78% margin for a solo photographer with fixed egress, **34% as built**, and **negative for a media company as built**. It converts a 93%-margin usage business into a fixed-fee hosting business with the worst cost curve of the seven models.

**To support burden:** the ledger becomes advisory rather than authoritative (we no longer own the invoice, so we cannot reconcile). Every fal outage, rate limit, quota exhaustion, expired key, wrong-region key and surprise fal bill becomes a support ticket we cannot see the cause of. That is why I modelled $6/tenant/mo against $2 — and $6 is optimistic.

**To the code:** BYO key is the single largest build in this report. `lib/imaging.ts:11` reads one global `process.env.FAL_KEY`; there is no per-tenant secret anywhere in the schema `[code]`. It needs encrypted per-tenant key storage, a key-resolution path threaded through `submitGeneration`, `runQA`, the interpreter and copywriting routes, per-tenant webhook routing (fal webhooks are signed against the *account*, so `verifyFalWebhook`'s JWKS check must be scoped per tenant), and a failure UX for invalid keys. Do not build it as a v1 tier.

### Where the other models break

- **Per-image / tiered / credits** are margin-positive at every volume in the grid — there is no break-even to find, because revenue and COGS both scale with photos and the ratio is ~16:1. They are the safest models and the hardest to sell: a photographer who has just moved off $1.50/image editing hears "$0.75/image" and does the arithmetic on 600 photos ($450/mo) rather than on their $18,000/mo revenue.
- **Subscription + included volume** is the reverse: easy to sell, and the margin decays monotonically with volume (91% → 52% typical, 90% → 23% as built). It is safe *only* because the overage price ($0.15) is 3× blended COGS. Never ship an included-volume tier without overage.
- **Hybrid** holds 72–95% across every segment and both egress modes, because the base fee covers the tenant-scaling costs and the surcharge covers the expensive chains. It is the most robust model in the grid and the most complex to explain.

---

## Recommendation

### Primary: per-listing subscription with included listings and a staging surcharge

| Tier | Price | Included | Overage | Target |
|---|---|---|---|---|
| **Agent** | **$39/mo** | 10 listings/mo, up to 40 photos each | $4/listing | Top realtor, small team |
| **Studio** | **$99/mo** | 35 listings/mo | $3/listing | Solo photographer |
| **Volume** | **$249/mo** | 100 listings/mo | $2/listing | Small media company |
| Surcharge, all tiers | **$1.00** per staged or renovated photo | — | — | The 10¢-COGS chains |
| Annual | 2 months free (−17%) | — | — | Cash + churn |

Margins at typical usage, fixed egress `[est]`: Agent 2 listings/mo → $39 rev / $4.85 COGS = **88%**. Studio 20 shoots → $99 / $32.5 = **67%**, rising to ~85% once the staging surcharge is counted on a vacant-heavy book. Volume 100 shoots → $249 / $180 = **28%** at the $249 price with no surcharge — which is exactly why the surcharge exists: a media company's real staging volume adds $80–$140/mo of surcharge revenue against $35 of extra COGS, landing 55–65%.

**Why per listing, not per image.** Three reasons, in order of weight:

1. **It is the unit the buyer already bills in.** Photographers quote $200–$500 per listing `[src]`; Fotello prices at $16–$18 per listing `[src]` and its own savings calculator converts photographers *off* per-image thinking. Per-listing pricing makes Listing Studio a line item inside a shoot fee rather than a meter the photographer watches.
2. **It caps the cost that actually scales.** Storage and egress scale with *listings and photos*, not with edits. A per-image price meters the cheap thing (inference, 4.5¢) and leaves the expensive thing (14 MB × forever) unpriced. A per-listing cap with a 40-photo soft limit prices both.
3. **It survives the egress bug either way.** Every tier above stays margin-positive in the as-built egress mode. The unlimited and BYO-key models do not.

**What it costs you:** a photographer with 5 huge 80-photo luxury shoots pays the same as one with 5 small 20-photo condos. Accept it, or make the photo ceiling explicit per tier (40 / 50 / 75, mirroring Fotello) and count anything over as a second listing.

### Fallback: credit packs at ~$0.80/credit blended

If the subscription does not convert — and for real estate agents it likely will not, since a typical realtor lists 4–5 times a *year* `[src]` and will not hold a monthly subscription — sell packs instead:

| Pack | Price | Credits | Per credit |
|---|---|---|---|
| 50 | $49 | 50 | $0.98 |
| 200 | $169 | 200 | $0.85 |
| 1,000 | $749 | 1,000 | $0.75 |
| 5,000 | $3,250 | 5,000 | $0.65 |

Credits never expire (PhotoUp's "forever packs" and StageHQ both use this and it removes the strongest subscription objection `[src]`). 1 credit = one delivered photo on any 1–2 step chain; staging or renovation = 3 credits; a 3-step chain = 3 credits. Margin **89–94%** at every volume in the grid, both egress modes. It is the safe answer, it monetises the occasional realtor, and it is a worse business: no recurring revenue, no forecastability, and the buyer feels every edit.

**Do not offer unlimited.** Do not offer BYO key as a v1 tier — if a media company demands it, sell it as a custom enterprise arrangement at $299+/mo with a contractual volume ceiling, priced so the support cost is covered.

---

## Product changes needed

Ordered by whether the recommended price can ship without them.

### Blocking — the recommended model cannot bill without these

| # | Change | Why | Where |
|---|---|---|---|
| 1 | **Add `user_id` to `spend_ledger`**, defaulted from `auth.uid()`, backfilled via `job_id`/`listing_id` | There is no way to total spend per tenant today. `job_id` and `listing_id` are both nullable and interpreter rows have neither, so those rows belong to nobody and are invisible to RLS | `supabase/migrations/`, `0011_room_proposals.sql:87` policy `[code]` |
| 2 | **Ledger failed generations** | The insert sits after the success transition, so fal-billed failures are never recorded. Any metered price built on this ledger under-bills, and reconciliation against the fal invoice will never balance | `lib/orchestrator.ts:305-325`, `handleGenerationError` `[code]` |
| 3 | **A `listings`-per-period counter and quota check** | The recommended unit is a listing/month. Nothing counts listings per period and nothing refuses work at the cap | new; `app/api/jobs/route.ts` is the enforcement point |
| 4 | **Per-tenant rate limit + per-tenant concurrency** | `MAX_CONCURRENT_RUNNING = 3` is global across all `file_groups`. One media-company batch starves every other tenant, and there is no rate limit on any route | `lib/orchestrator.ts:56` `[code]` |
| 5 | **Billing integration** (Stripe subscriptions + metered overage) | No billing code exists anywhere in the repo | grep: no `stripe`/`subscription`/`plan` outside `lib/terms.ts` `[code]` |

### Near-blocking — margin, not correctness

| # | Change | Why |
|---|---|---|
| 6 | **Thumbnails + signed-URL caching** (the work explicitly deferred out of Phase 55, `PLAN.md:835` `[code]`) | This is the difference between $580/mo and $3,950/mo of infra at 200 tenants, and between 52% and 23% gross margin on a media-company subscription. It is the highest-leverage change in this report |
| 7 | **Storage retention policy** | Originals are immutable and nothing is deleted `[code]`. Storage compounds forever and there is no policy, no cold tier, no expiry. Publish a retention window (12 months on Studio, 24 on Volume) and enforce it |
| 8 | **Staging/renovation surcharge metering** | The surcharge needs a count of delivered photos whose `edit_chain` contains `VIRTUAL_STAGING` or `VIRTUAL_RENOVATION`. `lib/deliver.ts:isStaged` already computes exactly this predicate — reuse it, do not write a second one |

### Worth doing, not blocking

| # | Change | Why |
|---|---|---|
| 9 | **Make `hasRefs → gemini` visible in the estimate** | Auto-attached floor-plan grounding silently doubles the rate (2.1¢ → 3.9¢) via `pickProvider`. `lib/simulate.ts` uses the flat 2.5 constant and will not show it |
| 10 | **Replace `AVG_GENERATIONS_PER_FILE_GROUP` with chain-derived counts** | 2.5 is a flat constant; real cost is `chain.length × rate` plus retries. `lib/simulate.ts:24` and `app/api/jobs/route.ts:138` both use it, and the batch-scope guard is built on it |
| 11 | **Refresh `BOXBROWNIE_CENTS`** | Four entries are stale against the live pricing page (colour change, item removal tier, portrait, floor plan). It drives a customer-facing comparison line |
| 12 | **Correct the upscale claim in `docs/claude-reference.md:71`** | Already flagged by the feature review. It matters here too: an upscale stage would add one fal call per delivered photo, raising blended COGS from 4.5¢ to roughly 6–7¢ `[est]`. Price it in *before* building it, not after |
