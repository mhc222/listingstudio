# Listing Studio — brand and marketing research

Date: 2026-09-03 · Read-only research pass · No source file changed, no build, no commit, no generation.

**Method and its limits.** Web search and fetch were available and used. Competitor positioning lines, pricing, and tone
come from live fetches of the marketing sites (or, where the host returned 403 — Aftershoot, Imagen, Pixieset — from
search results plus prior knowledge, marked *(search)* in the table). **Hex values for competitor palettes were not
machine-sampled**; no screenshot or CSS extraction was possible through the fetch tool, so competitor colors are
described as families, not hex. Domain availability was checked live against the Vercel registrar API (23 candidate
domains, 8 batches). One caveat on that data: Vercel reports "not available for purchase," which conflates *registered*,
*premium/reserved*, and *not resellable through Vercel*. Treat every "taken" below as "not cheaply acquirable via
Vercel," and confirm the shortlist through a registrar WHOIS before buying. Trademark notes are quick-search signals,
not clearance opinions.

Internal sources read: `CLAUDE.md`, `UI-SPEC.md` (full), `42-UX-BENCHMARK.md` (visual sections), `app/globals.css`,
`app/layout.tsx`, `app/page.tsx`, `components/brand.tsx`, the brand/visual entries in `DECISIONS.md`, and the executive
summaries of the three reviews in `docs/reviews/`.

---

## Executive summary

1. **Matt does not dislike Editorial Luxury. He has never seen it.** `DECISIONS.md:129` specifies Cormorant Garamond +
   DM Sans + Public Sans, 2–3px radii, hairline borders. The shipped `app/globals.css` loads **no web font at all**
   (`--font-display: var(--font-system)`), and radii are 10–20px (`rounded-[0.65rem]`, `rounded-[1.25rem]`). There is no
   `next/font` import anywhere in `app/` or `components/`. Cormorant appears only in `lib/deliver.ts` and `lib/reel.ts`,
   where it falls back to Georgia locally and a generic Linux serif on Vercel.
2. So the live product is not "editorial luxury." It is **warm-cream system-font SaaS with a brass accent** — which is
   exactly the thing that reads generic. The phase-38 header comment in `globals.css` says so out loud: hierarchy now
   comes from "space, weight and physical surfaces" instead of "decorative type."
3. The wordmark compounds it. `components/brand.tsx` still ships the **abandoned Darkroom lockup** (crop marks + a
   rectangle + a baseline bar) under a live `TODO(brand)`, set in a system sans. It is an orphan from a dead identity
   sitting in the masthead of every page.
4. Competitively, warm/brass is genuinely differentiating. **Every** direct competitor checked — BoxBrownie, Styldod,
   ReimagineHome, Collov, Autoenhance, HomeJab, Pixlmob — lands on navy/dark-blue + white + neutral sans. The category
   is monochromatic. But brass + cream + garamond is its own saturated template (every boutique hotel and DTC furniture
   brand since 2022), so it swaps one cliché for another.
5. The real problem with brass-and-linen is not fashion, it is **ergonomics**. A warm cream ground next to a photo
   biases white-balance judgment. Every color-critical tool — Lightroom, Capture One, Photoshop, DaVinci, Frame.io —
   uses neutral grey or neutral dark for exactly this reason. `UI-SPEC.md:361` already concedes the point ("the canvas
   surround may be a dark warm neutral because it is a photographic viewing surface"). The design system is arguing
   with itself.
6. **"Listing Studio" is unownable.** `listingstudio.com`, `listingstudio.co`, `listing.studio`, and
   `thelistingstudio.com` are all taken. No federal registration surfaced for the exact phrase, which is itself the
   signal: "listing" + "studio" is descriptive and hard to register for real estate photo software. Search for it and
   you get listicles, ListingPix, Aryeo, and Luminar.
7. The .com and .studio space for any dictionary-word compound is fully squatted. Of 23 checked, **10 were available**;
   the viable ones are `clerestory.studio`/`clerestory.co`, `enlarger.studio`, `duskwork.studio`, `frontlit.studio`,
   `lightbench.studio`, `contactsheet.co`/`.studio`, `soffit.studio`, `dodgeburn.studio`, `baryta.io`, `fixerwork.com`.
8. **Recommended name: Clerestory.** A clerestory is the high window that brings daylight into a room — literally the
   product's job, in a word architects and realtors half-recognize and photographers respect. `.studio` at $21.99 and
   `.co` at $123.20 are both open. Risk is moderate, not clean: a kitchen/bath invoicing SaaS holds `clerestory.app`,
   and there are `CLEARSTORY` marks in construction software and video (different spelling, different classes).
9. **Recommended visual direction: Neutral Studio** — a color-managed production environment. Neutral grey ground,
   true-neutral dark image canvas, one oxide-red signal color used only for state, photography as the only chroma.
   Archivo + Inter + Plex Mono numerals. It is maximally differentiated from the navy category, honest about being a
   daily production tool, and it fixes the color-judgment problem instead of writing an exception into the spec.
10. Whatever direction wins, the **first fix is not a new palette — it is implementing one.** Load real fonts, settle
    the radius, and replace the Darkroom mark. Three quarters of the "I don't love it" is an unshipped design system.

---

## 1. Competitive landscape

### Direct competitors

| Name | Positioning line | Color family | Type feel | Tone | Pricing model | Targets |
|---|---|---|---|---|---|---|
| **BoxBrownie** | "Professional Photo Editing, Virtual Staging, Floor Plan Redraws, & Renders at Unbeatable Prices" | Deep navy, white, gold/warm CTA | Clean corporate sans, tight, utilitarian | Transactional, price-forward, high-volume. Reads like a print shop order form | Per-image, no subscription: enhancement $2, day-to-dusk $5, item removal $5–10, staging $30, floor plan $30–45, renders from $350. Unlimited revisions | Agents, brokers, commercial RE. Secondary: e-commerce sellers |
| **Styldod** | "Turn home photos into decisions you can act on" — "decision-grade visuals … that preserve real-world constraints" | Navy/charcoal, warm accent, white | Modern sans, clear hierarchy, no display voice | Sober, anti-hype, enterprise-inflected. "Decision" over "inspiration" | Three unnamed tiers (self-serve ReimagineHome, 24–48h expert services, enterprise Smart Media Module). Prices not published | Agents, brokerages, MLSs, homeowners, designers, retailers — deliberately multi-audience |
| **Virtual Staging AI** | "Virtual Staging with one click" — "indistinguishable from human virtual staging" | White, charcoal, minimal accent | Minimalist sans, clarity over character | Friendly-professional, friction-removal. Leans on press logos (HousingWire, TechCrunch) for credibility | Subscription from $16/mo for 6 images; unlimited regenerations | Agents/realtors. MLS-compliance framing gives it away |
| **REimagine Home** | "Design clarity you can act on" | Deep navy/charcoal, warm accents, neutrals | Modern, approachable, direct | Honest and outcome-anchored; cites usage data ("7/10 outputs downloaded") instead of hype | Freemium: free "Decision Mode" (5 designs) → Pro "Execution Mode" unlimited | Homeowners ($2.5–15K spend), RE pros, interior/landscape designers |
| **Collov** | "Redefine space with Collov AI intelligent design" | Deep navy/dark blue, white/cream | Clean modern sans | Confident, metric-heavy, promotional. "+73% faster sales," "under 15 seconds," coupon codes | Subscription with running promo discounts | Agents, interior designers, homeowners |
| **PhotoUp** | "The #1 Platform for Photo Editing Services & Real Estate Marketing" | Neutral tones, accent colors, photo-led | Clean professional sans | Reliability and partnership over hard sell. "The Most Trusted Name," "We're always there" | Human-labor tiers: Distributed / Dedicated / Enterprise. ~$0.50–1.00 per edit, from $7.94/hr | RE photographers and agents outsourcing production |
| **Autoenhance.ai** | "AI Photo Editing for Real Estate Photographers" — "consistent, listing-ready edits in minutes … without outsourcing headaches" | Deep navy/dark grounds, white, selective color | Clean modern sans, technical competence | Direct, results-first, low jargon. Positions between DIY and outsourcing | Freemium + subscription tiers (not published on home) | **RE photographers and media teams** — the closest direct analogue to Listing Studio |
| **Fotello** *(search)* | "AI real estate photo editing with free human revisions and pay-as-you-go pricing"; describes output as "editorial-quality … in minutes" | Light, clean, photo-led | Modern sans | Reassuring; leads with "every frame checked by a real editor, no weird AI fingerprints" | Per listing: Essential $16/listing (~$1,200/mo at 75 listings), Ultimate $18/listing | RE photographers and media creators, volume operators |
| **Pixlmob** | "The Real Estate Media Editing Marketplace" — "Built by RE Photographers for RE Photographers" | Blues and whites, service-coded accents | Modern sans, scannable | Peer-to-peer and conversational. "Turn winter to summer," "Make unwanted items disappear" | Marketplace; editors set their own rates. HDR blending from $0.95, staging from $10 | RE photographers wanting vetted editors without vendor management |
| **HomeJab** | "Premier Real Estate Photography & Video" — "America's leading real estate photography company … starting at $179" | Deep navy, white/cream, gold logo accent, greys | Clean sans, approachable-professional | Confident and operational. "Book in 60 seconds. Delivered same-day." | Service packages from $179; modular add-ons; no travel fees | Agents at major brokerages; builders, PMs, multifamily, commercial |

### Adjacent best-in-class creative tools

| Name | Positioning line | Color family | Type feel | Tone | Pricing model | Targets |
|---|---|---|---|---|---|---|
| **Photoroom** | "Sell at first sight" — "the full AI visual solution for e-commerce" | Minimalist; product imagery *is* the color. Near-monochrome chrome | Modern geometric sans, tech-confident | Outcome and throughput. "Thousands of images live in minutes, not launch cycles" | Free trial → Growth → Business → enterprise custom | Solo sellers → scaling brands → enterprise catalog teams |
| **Adobe Lightroom** | Photo editing and organization for photographers, everywhere | **Neutral dark greys**, one blue signal accent, zero decoration | Adobe Clean — neutral, invisible, dense-data legible | Instructional, feature-neutral, no persuasion inside the app | Photography plan subscription, cloud-storage tiered | Working photographers, hobbyist to pro |
| **Pixieset** *(search)* | "Client Photo Gallery, Website, CRM for Photographers" — all-in-one for the modern photographer | Soft off-whites, muted warm neutrals, restrained; **the gallery is white-labeled to the photographer** | Light, elegant, generous whitespace; near-editorial | Calm, service-oriented, brand-deferential. Its chrome disappears behind the photographer's brand | Freemium → Client Gallery tiers → Suite bundle | Wedding/portrait photographers delivering to clients |
| **Aftershoot** *(search)* | "Cull, edit, retouch, and deliver — one complete platform, built for professional photographers" | **Dark app UI**, bright marketing site, high-contrast | Friendly modern sans, rounded, energetic | Peer, workflow-empathetic, time-back framing. Flat-rate as a moral position vs per-image | Flat subscription, unlimited photos: culling from $10/mo, editing from $30/mo, full workflow from $45/mo annual | 50,000+ high-volume wedding/portrait/event photographers |
| **Imagen AI** *(search)* | Personal AI Profile — "the scalability of outsourcing with the consistency of editing yourself" | Clean light, restrained accent | Modern sans, professional-neutral | Technical and evidence-led; talks in cents per photo and profile training volumes | **Per-image: $0.05/photo, $7/mo minimum**; add-ons +$0.01/photo each | Wedding/portrait pros with existing Lightroom catalogs |

### What the landscape actually tells you

- **The category has one color.** Nine of ten direct competitors are navy/dark-blue + white. Any warm, neutral-grey, or
  dark-neutral identity is differentiating on contact.
- **The category has one voice: speed and price.** "In minutes," "one click," "$2 per image," "73% faster." Nobody sells
  *control*, *provenance*, or *not breaking the photo*. Listing Studio's actual differentiators — verbatim geometry
  constraints, immutable originals, named version lineage, per-call spend truth, a manifest-backed delivery package —
  are unclaimed territory. That is the positioning gap, and it is wide.
- **Photographer-facing tools go dark; realtor-facing tools go light.** Lightroom and Aftershoot's app UI are dark.
  Every realtor-facing product checked is light. This is the single fact that should decide Direction 3 vs Direction 1,
  and it confirms the `DECISIONS.md:129` research note — but that note assumed a realtor audience. Matt is a
  photographer.
- **Two pricing archetypes, and both beat BoxBrownie.** Per-image at Imagen's $0.05 (vs BoxBrownie's $2.00), or flat
  unlimited at Aftershoot's $45/mo. Fotello's $16–18 *per listing* is the RE-specific middle. If Listing Studio ever
  ships to other photographers, flat-rate-unlimited is both the differentiated position and the one that matches a
  fal.ai cost base of roughly two cents a photo.
- **Pixieset is the model for chrome restraint**, and the most relevant reference for a photographer's daily tool: its
  interface recedes so the photographs and the photographer's own brand carry the room.

---

## 2. Naming

### 2.1 Critique of "Listing Studio"

**It is a category label, not a name.** "Listing" is the single highest-frequency noun in real estate; "Studio" is the
single most-used suffix in creative software (Android Studio, Visual Studio, Luma Studio, Canva Studio, Meta AI Studio,
Fusion Studio). Together they describe the product without identifying it. Say it at a conference and nobody will
remember which one you meant.

**It is not acquirable.** All four obvious domains are gone: `listingstudio.com`, `listingstudio.co`, `listing.studio`,
`thelistingstudio.com`. That forces a "get-", "use-", "-hq", or "-app" prefix, which reads as second-choice forever.

**It is probably not registrable.** No federal registration surfaced for the exact phrase — which is the tell. A mark
that merely describes the goods ("a studio for listings," for software that edits listing photos) is descriptive and
faces a §2(e)(1) refusal absent acquired distinctiveness. You would be building a brand you cannot defend.

**SEO is unwinnable.** Searching the phrase returns generic "best real estate photography software" listicles, plus
ListingPix, Aryeo, Luminar Neo, and CloudPano. You are competing against the literal words agents type when they want
something else. There is no query for which you are the intended answer.

**It also undersells the product.** The thing in the repo is a full production spine — resumable intake, HDR bracket
review, room organization, batch scope, proofing, approved finals, MLS delivery with a manifest. "Listing Studio"
promises a photo filter.

The one thing it does well: it is instantly legible to a realtor. Any replacement has to earn that back with a tagline.

### 2.2 Candidates

Domain column reflects the live Vercel registrar check on 2026-09-03. "—" means every checked TLD for that name came
back unavailable. Prices are first-year.

**Direction A — Photographer craft (darkroom and print process)**

| Name | Domain | Collision risk | Rationale |
|---|---|---|---|
| **Enlarger** | ✅ `enlarger.studio` $21.99 (.com, .app taken) | Low. No RE or SaaS collision found | The darkroom machine that turns a negative into a finished print. Exact functional metaphor, instant photographer credibility, and it already matches the app's `.develop-in` motion language |
| **Contact Sheet** | ✅ `contactsheet.co` $29.99, `contactsheet.studio` $21.99 (.com, .app taken) | **High.** `contactsheet.app` is a live film contact-sheet iOS app; several Mac/iOS "Contact Sheet" apps; contactsheetmaker.com. Descriptive term — likely unregistrable | The proofing surface, and the product literally ships one (`Proofing` route). Beautiful fit, legally weak |
| **Dodge & Burn** | ✅ `dodgeburn.studio` $21.99 | Low as a mark; the phrase is common photo vocabulary | The two operations of print retouching. Very photographer, but two words plus an ampersand is a bad wordmark and a worse URL |
| **Baryta** | ✅ `baryta.io` $30 (.com, .co, .studio, .app taken) | Low. Also a mineralogy/paper term | Fine-art fiber paper base. Gorgeous and ownable-sounding. Too obscure to mean anything to a realtor without a tagline |
| **Fixer** | ✅ `fixerwork.com` $11.25 (`fixer.studio`, `getfixer.com` taken) | Moderate. "Fixer" is common in RE and services | The chemical that makes an image permanent, *and* fixer-upper. Best double meaning in the set, but the bare name reads as a handyman app |
| **Latent** | — (`latent.studio`, `latent.co`, `latentroom.com` all taken) | **High.** "Latent" is saturated in AI (latent space, Latent Labs) | The exposed-but-undeveloped image. Elegant lineage, but it now signals "AI startup" more loudly than "photography" |
| **Proof Room** | — (`proofroom.com`, `proofroom.studio` taken) | Moderate | Proofing plus a room, and the app has both. Domains gone |

**Direction B — Light and time**

| Name | Domain | Collision risk | Rationale |
|---|---|---|---|
| **Frontlit** | ✅ `frontlit.studio` $21.99 (`frontlit.com` taken) | Low. Only sign-industry usage ("frontlit banner") | Photographic lighting term *and* the lit front of a house. Two syllables, zero spelling ambiguity, says "we handle the light" |
| **Duskwork** | ✅ `duskwork.studio` $21.99 (`duskwork.com`, `.co` taken) | Low. Coined | Day-to-dusk is the signature, highest-margin edit. Sounds like a craft workshop. Risk: names one of twelve edit types, so it could read narrow |
| **Northlight** | — (`.com`, `.co`, `.studio` all taken) | **Very high.** Northlight Stills & Motion does Seattle *real estate photography and virtual staging*; Northlight Images (UK); Northlight Studio Inc.; Northlight Photography (CA) | The photographer's ideal window light. Perfect meaning, thoroughly occupied by the exact industry. Drop it |
| **Golden Hour** | — (`goldenhour.studio` taken) | High. Universally used photo cliché | Meaningful and warm, but every third photographer's Instagram bio | **Skip** |
| **Lightbench** | ✅ `lightbench.studio` $21.99 (`lightbench.com` taken) | Low | A bench is where a craftsperson works; light is the material. Honest description of a production workbench. Slightly generic-tech |

**Direction C — Architecture and property**

| Name | Domain | Collision risk | Rationale |
|---|---|---|---|
| **Clerestory** | ✅ `clerestory.studio` $21.99, `clerestory.co` $123.20 (`.com`, `.app` taken) | **Moderate.** `clerestory.app` = kitchen/bath invoicing SaaS; Clerestory Consulting (acquired by EY, 2021); `CLEARSTORY` marks in construction software and video (different spelling) | The high window that brings daylight deep into a room — precisely what the product does to a dark interior. Architectural, distinctive, memorable, and no photography-industry occupant |
| **Casement** | — (`.studio`, `.co`, `.app` taken) | Moderate. Window manufacturers | A window that opens. Clean and short; nothing acquirable |
| **Fenestra** | — (`.studio`, `.co` taken) | Moderate. Fenestra Ltd, various | Latin for window. Elegant; nothing acquirable |
| **Transom** | — (`.studio`, `.co`, `.app` taken) | Moderate. Transom.org (public radio); Transom Consulting | The window above a door. Nothing acquirable |
| **Frontage** | — (`.com`, `.co`, `.studio` taken) | Moderate | The street-facing face of a building — curb appeal in one word realtors already use. Nothing acquirable |
| **Soffit** | ✅ `soffit.studio` $21.99 (`soffit.co` taken) | Low | Available, architecturally literate — but a soffit is the underside of an eave. It means nothing about light or photographs. **Skip** |
| **Threshold / Sightline / Elevation / Gable / Loggia / Portico / Plinth / Vantage** | — all taken | — | Checked as a block for completeness; every one is occupied on `.studio`, `.co`, and `.com` |

**Direction D — Descriptive and coined**

| Name | Domain | Collision risk | Rationale |
|---|---|---|---|
| **Stillwork** | — (`.com`, `.co`, `.studio` taken) | Low as a mark | Stills, and work. The best coined option in the set; entirely unacquirable |
| **Listwell** | — (`listwell.com` taken) | Moderate | Descriptive-adjacent, warmer than "Listing Studio," still fights the same generic-"list" SEO |
| **Shootroom / Proofroom / Roomform / Framewell / Silverprint / Daybreak / Plateshop** | — all taken | — | Checked as a block; none acquirable |

### 2.3 Shortlist of five

Ranked. Each has a confirmed available domain.

1. **Clerestory** — `clerestory.studio` ($21.99) + `clerestory.co` ($123.20). A high window that floods a room with
   daylight, which is literally the product's core promise. Architectural enough that realtors sense the register,
   specific enough that photographers respect it, and no photography-industry incumbent. Buy both TLDs. Costs: four
   syllables, and roughly everyone will first type "Clearstory." Mitigate by registering the `clearstory.*` variants you
   can get, and by never letting the wordmark appear without the tagline in the first year.
2. **Enlarger** — `enlarger.studio` ($21.99). The cleanest functional metaphor available: the device that turns a
   capture into a finished print. Zero real-estate collision, maximum photographer credibility, and it dovetails with
   motion language already in `globals.css`. Costs: "enlarge" carries a faintly spammy adjacency, and `.com` is gone.
3. **Frontlit** — `frontlit.studio` ($21.99). Two syllables, unmistakable spelling, and a genuine double meaning
   (photographic front lighting; the lit facade of a house). The most *usable* name in the set — easiest to say on the
   phone, easiest to set as a wordmark. Costs: abstract until explained, and the least emotionally distinctive.
4. **Duskwork** — `duskwork.studio` ($21.99). Coined, ownable, and it sounds like a workshop rather than a SaaS. Anchors
   to the single most valuable edit the product performs. Costs: it names one capability, which caps the brand if the
   product ever leads with staging or floor plans.
5. **Lightbench** — `lightbench.studio` ($21.99). The most honest name for what this actually is: a workbench where
   light is the material. Low collision, easy to spell, immediately understood by a photographer. Costs: mildly generic;
   sounds like a component library.

**Not shortlisted, and why:** Contact Sheet (best fit, worst legal position — descriptive term with live app
collisions); Northlight (occupied by real estate photography businesses in three countries); Baryta (too obscure to
carry meaning without a paragraph); Fixer (bare name reads handyman); Latent (now reads AI-lab).

**If the name stays.** It is defensible to keep "Listing Studio" for a single-user internal tool — nobody is searching
for it and nobody is confusing it. But then stop treating it as a brand: put the budget into the visual system and the
mark, and reserve the rename for the moment it ships to a second photographer.

---

## 3. Visual direction

### 3.1 Honest critique of brass-and-linen editorial luxury

**What is genuinely right about it.**

- **The competitive read is correct.** Nine of ten direct competitors are navy-and-white. Warm cream is the highest-
  contrast strategic move available in this category, and it was arrived at deliberately, with recorded reasoning.
- **Photography-first is the right organizing principle.** "Photography remains the colour and emotional focus"
  (`UI-SPEC.md:363`) is the single best line in the spec. Every strong reference in the adjacent set (Pixieset,
  Photoroom, Lightroom) does exactly this.
- **The restraint rules are excellent and worth carrying into any new direction verbatim:** no nested bordered boxes,
  state pills as a colored dot plus tracked label rather than a tinted fill, no per-edit dollar figures in the editing
  surface, no glossy gradients, no credit badges.
- **The motion language is genuinely original.** `.develop-in` — a print coming up in the tray, implemented in pure CSS
  via `@starting-style` — is the most brand-bearing thing in the codebase. It survives any repalette. Keep it.
- **Dropping mono from the UI was correctly reasoned** *for a realtor audience*. Flag it, because the audience premise
  may be about to change.

**Where it does not hold up.**

- **It is not implemented, so it cannot be judged.** No `next/font` import exists. `--font-display` and `--font-ui` both
  resolve to `--font-system`. Radii are `0.65rem`–`1.25rem` where the spec says 2–3px. What ships is warm-cream
  system-font SaaS with a brass accent, and that reads exactly as generic as Matt says. **This is the finding that
  matters most: the majority of the complaint is an unshipped design system, not a wrong one.**
- **The mark is from a dead identity.** `components/brand.tsx` still carries the Darkroom crop-mark lockup under a live
  `TODO(brand)` from 2026-08-31. Crop marks are a print-production reference that says nothing about interiors, and the
  wordmark is set in the same system sans as body copy, so the masthead has no brand voice at all. The logo is the first
  thing anyone sees and it is the least-designed object in the product.
- **Brass + cream + Garamond is its own cliché.** It differentiates from RE SaaS and converges with every boutique
  hotel, DTC furniture brand, and wedding photographer template since about 2022. It reads *2023 luxury e-commerce*,
  which is dated in a specific and recognizable way.
- **It borrows the wrong reference class.** The stated targets are RH and West Elm — *consumer catalog* brands whose job
  is to make you want a sofa for ninety seconds. This product's job is to let one person judge and ship four hundred
  photographs a week. Catalog aesthetics optimize for desire; production tools optimize for accuracy and low fatigue.
  Those are different problems and they produce different interfaces.
- **The warm ground is a color-judgment hazard.** A `#F3EEE4`/`oklch(0.965 0.006 85)` surround shifts perceived white
  balance in an adjacent photograph. This is why every color-critical application converged on neutral grey or neutral
  dark. `UI-SPEC.md:361` already writes the exception ("the canvas surround may be a dark warm neutral because it is a
  photographic viewing surface") — the system is conceding at the exact point where it matters most, and paying for a
  jarring transition between chrome and canvas to do it.
- **Light-only is a fatigue decision made for the wrong user.** A photographer culling and proofing for hours in a dim
  room on a bright cream screen. The reasoning in `DECISIONS.md:95`/`:129` was sound for a 57-median-age realtor
  audience; it does not survive the audience being a working photographer.
- **The serif was carrying too much of the differentiation.** With Cormorant absent, the identity has nothing left but
  a brass hue. That is why removing one unimplemented font collapsed the whole thing into generic — a brand that fragile
  was over-indexed on decoration to begin with.

**Verdict.** The strategy (warm, photography-first, restrained, anti-SaaS) is good and was well reasoned. The execution
never landed, and the specific expression — luxury-catalog warmth — is the wrong ergonomic choice for a daily
high-volume production tool. Keep the restraint rules and the motion language. Replace the ground, the accent, and the
type.

### 3.2 Three directions

---

#### Direction 1 — **Neutral Studio**

*A color-managed production environment. The photograph is the only thing in the room with a color.*

**Mood.** Capture One, DaVinci Resolve, a print lab, a light table. Quiet, precise, industrial. It does not try to be
beautiful; it tries to be accurate, and reads as expensive because of that. The nearest brand analogue is Lightroom's
chrome discipline crossed with Photoroom's near-monochrome confidence.

**Palette.**

| Token | Hex | Role |
|---|---|---|
| `--background` | `#F4F4F5` | Neutral grey ground, zero color cast |
| `--card` | `#FFFFFF` | Raised surface |
| `--muted` | `#E9E9EC` | Recessed fill |
| `--canvas` | `#1A1A1C` | True-neutral image surround (chrome and canvas now agree) |
| `--foreground` | `#17171A` | Ink |
| `--muted-foreground` | `#6B6B72` | Secondary |
| `--border` | `#DEDEE1` | Hairline |
| `--primary` | `#A63D24` | Oxide red — safelight/pigment. Actions and "system acting" only |
| `--primary-foreground` | `#FFFFFF` | |
| `--state-complete` | `#2F6B4F` | |
| `--state-failed` | `#B3261E` | |
| `--state-qa` | `#A9761A` | |
| `--state-queued` | `#6B6B72` | |

Radius 4px. Hairlines at 1px. No shadow above `0 1px 2px` except for true overlays.

**Type (Google Fonts).** **Archivo** for display and UI (a grotesque with real structural character and a condensed
sibling for dense labels) + **Inter** for body and long text + **IBM Plex Mono** restricted to numerals: dimensions,
byte sizes, exposure values, EXIF, spend. Note this reverses the `DECISIONS.md:129` mono removal — deliberately, because
that call was made for a realtor audience and mono numerals are native literacy for photographers reading exposure
data. If the audience is realtors, drop the mono and use Inter's tabular figures.

**How it feels.** The listing page is a light table: a neutral grey field, hairline-separated regions, no cards inside
cards, dense tabular type for shoot inventory, and photographs as the only saturated objects on screen. Opening Task
Studio drops the canvas to true-neutral `#1A1A1C` and the transition is seamless because the chrome was already
neutral — the image is finally being judged against nothing. Oxide red appears in maybe four places: the primary
action, the running-state dot, a destructive confirm, a focus ring. Proofing becomes genuinely fast, because with no
competing warmth your eye goes straight to which of two frames is correct. The public home page inverts the ratio:
full-bleed photography carries all the emotion, the chrome shrinks to a hairline masthead and one oxide button, and
Archivo at large display sizes does the rest. It looks like professional equipment. Nobody will call it luxurious, and
nobody will call it generic.

---

#### Direction 2 — **Field & Frame**

*A working photographer's studio, not a luxury hotel. An evolution of the current direction rather than a reset.*

**Mood.** Warm paper, ink-black type, deep slate green. Reads like a well-made field notebook or a Kinfolk-adjacent
trade brand — warm and human, but *desaturated* and grown up rather than gilded. Keeps the warmth Matt originally
reached for while removing the yellow and the brass.

**Palette.**

| Token | Hex | Role |
|---|---|---|
| `--background` | `#F2F0EC` | Warm grey paper — markedly less yellow than the current `#F3EEE4` |
| `--card` | `#FBFAF8` | |
| `--muted` | `#E8E5DF` | |
| `--canvas` | `#201F1D` | Warm-neutral image surround |
| `--foreground` | `#1C1B19` | |
| `--muted-foreground` | `#6E6A63` | |
| `--border` | `#DAD6CF` | |
| `--primary` | `#3F5D50` | Deep slate green — landscape adjacency, neither navy nor brass |
| `--accent` | `#C4712F` | Terracotta, illustration and empty states only |
| `--state-complete` | `#4A6F45` | |
| `--state-failed` | `#A8483F` | |
| `--state-qa` | `#B08427` | |
| `--state-queued` | `#6E6A63` | |

Radius 3px. Hairline borders. Generous vertical rhythm.

**Type (Google Fonts).** **Fraunces** for display, at a low optical-size setting with `wonk` on — an old-style serif
with genuine idiosyncrasy, so the editorial voice comes from character rather than from generic elegance (this is the
specific fix for Cormorant's wedding-invitation problem) + **Public Sans** for UI, labels, and body, which is already in
the decision record and is a properly legible humanist workhorse.

**How it feels.** Closest to the current intent, finally executed. The listing hero is a full-bleed photograph with a
Fraunces address over a warm scrim; below it, generous whitespace, hairline rules, and Public Sans labels in tracked
uppercase. Slate green replaces brass everywhere, which immediately reads less 2023 and more trade-craft. Task Studio's
control rail is warm paper against a `#201F1D` canvas — still a transition, but a much smaller one than cream-to-dark.
The public home page is where this direction earns its keep: Fraunces at 72px over a dusk exterior is genuinely
beautiful and would out-market every navy competitor on the page. The cost is honest — the warm ground still biases
white-balance judgment in proofing, and eight hours of it is more tiring than neutral grey.

---

#### Direction 3 — **Darkroom Pro**

*Dark-first and photo-review-native. The tools every photographer already lives in.*

**Mood.** Lightroom, Frame.io, DaVinci, Aftershoot's app. Cinematic, focused, low-fatigue. The brand lives in one warm
signal and in the photography. Reverses the phase-26 light-only decision explicitly.

**Palette.**

| Token | Hex | Role |
|---|---|---|
| `--background` | `#131315` | |
| `--card` | `#1C1C1F` | |
| `--muted` | `#26262A` | Raised/recessed fill |
| `--canvas` | `#0B0B0C` | Image surround, deepest surface |
| `--foreground` | `#EDEDF0` | |
| `--muted-foreground` | `#9A9AA2` | |
| `--border` | `#313136` | |
| `--primary` | `#E0A34A` | Warm amber — brass lineage, at the luminance where it actually sings |
| `--primary-foreground` | `#17150F` | |
| `--state-complete` | `#56A46F` | |
| `--state-failed` | `#E06A5F` | |
| `--state-qa` | `#D6A32B` | |
| `--state-queued` | `#9A9AA2` | |
| marketing ground | `#FAFAF9` | The public site stays light; only the app is dark |

Radius 6px. Borders at 1px `#313136`, no shadows (elevation via surface value, as dark UIs require).

**Type (Google Fonts).** **Instrument Serif** for display — high-contrast, editorial, and genuinely striking reversed
out of near-black + **Inter** for all UI, body, and data.

**How it feels.** Opening a listing feels like opening Lightroom. The tray, the contact sheet, and the batch grid all
sit on `#131315`, and every photograph gains apparent contrast and saturation for free — proofing forty frames is
markedly less tiring than on cream. Amber appears only where the system is acting: a running dot, the primary action,
a QA flag. Task Studio's control rail at `#1C1C1F` against a `#0B0B0C` canvas has no transition at all; it is one
continuous viewing environment. The tradeoff is real and it is strategic: this is the *photographer's* choice and the
*wrong* choice for a realtor audience — `DECISIONS.md:129` records that dark mode was absent from every realtor-facing
comparable checked (BoxBrownie, Follow Up Boss, kvCORE, PhotoUp, Matterport, Compass). Mitigate by keeping the public
site light with full-bleed photography and Instrument Serif display, so a realtor never sees the dark app before
signing in. It also unwinds `DECISIONS.md:130` (light-only by design), which means reinstating `prefers-color-scheme`
handling that was deliberately removed.

### 3.3 Recommendation

**Direction 1 — Neutral Studio.**

Reasons, in order of weight:

1. **It resolves the contradiction instead of documenting it.** A neutral chrome means chrome and image canvas finally
   agree, and `UI-SPEC.md:361`'s exception becomes a property of the system rather than a carve-out.
2. **It is the correct ergonomics for the actual job.** Judging exposure and white balance on hundreds of interiors is
   the product's core loop. A neutral grey field is the only ground that does not lie to you about it.
3. **It is more differentiated than warmth, not less.** Warm cream distinguishes from navy RE SaaS but converges with
   boutique-luxury. Neutral grey with a single oxide signal reads as *professional instrument* and looks like nothing
   else in either set.
4. **It is the least fragile.** Direction 2's whole identity rests on Fraunces rendering; Direction 3's rests on a dark
   ground the marketing site cannot use. Direction 1 survives font fallback, print, screenshots, and a light or dark
   canvas without losing its character.
5. **It is honest about what this is.** A tool one person runs their business through, not a consumer brand. Reference
   class: Lightroom's discipline and Pixieset's restraint, not RH's catalog.

Direction 1 does not throw away the good work: the restraint rules, `.develop-in`, the dot-plus-label state pills, the
no-prices-in-the-editing-surface rule, and photography-as-the-only-color all carry over unchanged.

**Second choice: Direction 3**, if Matt confirms this stays his own production tool and never faces a realtor. It is
the best experience for a photographer, and the worst risk if the audience premise flips.

**Direction 2 is the safe answer**, and it is what I would build if the decision is "finally execute what we already
decided." It is a real improvement on what ships today. It is just not the best version of this product.

---

## 4. Positioning and voice

Written as if the product were offered to other real estate photographers, per the brief. The audience is the working
professional shooting 5–20 listings a week who currently outsources to BoxBrownie, PhotoUp, or Pixlmob and hates the
handoff — the same audience Autoenhance.ai and Fotello are fighting over, and the audience Matt actually is.

### One-sentence positioning

> **Clerestory is the production studio real estate photographers run their own shoots through — camera card to
> MLS-ready gallery — where every edit is described in plain language, every original stays untouched, and the room
> never changes shape.**

### Three value props

1. **The whole shoot, one surface.** Intake, HDR bracket review, room organization, editing, proofing, approved finals,
   and MLS delivery in one continuous workspace with one edit history. Not eight vendors, an email brief, and a Dropbox
   link. *(No competitor spans this range; Fotello and Autoenhance cover the middle, PhotoUp and Pixlmob outsource the
   labor, Aryeo owns delivery only.)*
2. **Say it, don't spec it.** Type what you want the way you'd say it to an editor. It compiles into the exact edit,
   shows you the plan before anything runs, and the geometry constraint is never paraphrased — walls, windows, and
   camera position come back identical. *(Nobody in the category sells control. They sell one click.)*
3. **Nothing is ever overwritten.** Originals are immutable, every version is named and branchable, every delivery
   ships with a manifest recording source, version, transformation, disclosure, and dimensions. When a broker asks what
   was changed, you have the answer. *(This is real MLS-compliance infrastructure. Competitors sell a staging watermark
   and hope.)*

### Tone of voice — five rules

1. **Name the thing, not the technology.** "Day to dusk." "Declutter." "Bracket merge." Never "generative relighting,"
   "diffusion pipeline," "AI-powered." The reader knows the craft; sell the outcome in their vocabulary.
2. **State the constraint with the promise.** Every capability sentence carries its limit in the same breath. "Furniture
   realistically scaled to the room — walls, windows, and camera angle untouched." "Highlight recovery from a bracket
   set, not from a single clipped JPEG." Honesty about the boundary is the differentiator in a category full of
   overclaims.
3. **Photographer to photographer.** Assume EXIF, brackets, verticals, mixed illuminant, and MLS disclosure rules are
   known. Never explain what a contact sheet is. Never say "simply" or "just."
4. **Short declaratives. No sales register.** No em dashes, no exclamation marks, no "unlock," "revolutionize,"
   "seamless," "effortless," or "game-changing." Oxford comma. If a sentence would sound wrong said out loud to another
   photographer at a shoot, rewrite it.
5. **Never claim a number you cannot show.** No "73% faster sales." No "+20% price boost." If a figure appears, it comes
   from the product's own ledger and links to where the reader can verify it. This is a direct swipe at Collov and it
   is worth taking.

### Hero headline and subhead, per direction

**Direction 1 — Neutral Studio**

> ## The whole shoot, start to delivered.
> Intake, brackets, rooms, edits, proofing, and an MLS package in one workspace. Describe the edit in plain language.
> The room comes back exactly as you shot it.

**Direction 2 — Field & Frame**

> ## Your shoot, finished by the time you're home.
> Say what the room needs and it happens — light, staging, dusk, clutter. Every original kept, every version named,
> every wall exactly where you left it.

**Direction 3 — Darkroom Pro**

> ## Camera card in. Gallery out.
> The production studio for photographers who stopped outsourcing. Plain-language edits, immutable originals,
> MLS-ready delivery with a manifest. Geometry locked.

### Copy that should be retired from the current home page

- *"Editorial listing photos in minutes — without the outsourced handoff."* — Contains an em dash (rule 4), and
  "editorial" is the one word Fotello also uses to describe its output. Nearest replacement above.
- *"Real estate photography, transformed"* — Category-generic eyebrow; says nothing only this product could say.
- *"Your next listing deserves better photos by this afternoon."* — Speaks to an agent, not to a photographer. If the
  audience is photographers, the closing CTA should be about the shoot, not the listing.
- *"You talk. It compiles."* — Keep this. It is the sharpest line on the page and it names the actual differentiator.

---

## 5. Recommended next steps

Ordered. The first three are the whole complaint; the rest is brand.

1. **Ship a design system before choosing a new one.** Add `next/font` to `app/layout.tsx`, wire real families to
   `--font-display` / `--font-ui` / `--font-sans`, and settle a single radius token. Right now the identity is
   unimplemented, so no judgment of it is valid. Half a day, and it will change how the product feels more than a
   repalette would.
2. **Look at the result before deciding anything else.** Deploy step 1 with the *existing* brass/linen tokens and the
   specified Cormorant + DM Sans + Public Sans. There is a real chance Matt likes the direction he decided on once he
   can see it, which makes steps 4–6 much cheaper.
3. **Kill the Darkroom mark.** `components/brand.tsx` has been shipping an abandoned lockup under a `TODO(brand)` for
   three days. Whatever direction wins, crop marks are wrong. Replace with a wordmark only — set in the chosen display
   face, no symbol — until a mark is actually designed. A typographic wordmark is never the weakest thing on the page;
   a borrowed symbol always is.
4. **Decide the audience, because it decides the palette.** One question, and everything downstream depends on it: is
   this permanently Matt's tool, or a product for other real estate photographers? Photographer-only makes Direction 3
   viable. Any realtor exposure rules it out and pushes toward Direction 1.
5. **Build one screen in each of the three directions and compare them side by side.** Use the listing page — it has
   the hero, the inventory counters, the tray, and the state pills, so it exercises the whole system. Do not evaluate
   palettes as swatches; evaluate them as a real screen with real photographs in it.
6. **Adopt Direction 1's neutral canvas immediately, whatever else wins.** Changing `--canvas` to a true neutral is a
   one-token change that measurably improves the color judgment in Task Studio and Proofing. It is a correctness fix,
   not a taste call, and it is compatible with all three directions.
7. **Secure the name before the design work, not after.** If Clerestory is the pick, buy `clerestory.studio` and
   `clerestory.co` now (~$145 combined) plus any `clearstory.*` misspelling variants available. Confirm through registrar
   WHOIS first — the Vercel check conflates registered with not-resellable. If the name is deferred, buy nothing and say
   so explicitly in `DECISIONS.md` so it stops being an open loop.
8. **Get a real trademark screen on the shortlist before spending on identity.** Clerestory is the one that needs it:
   `clerestory.app` is a live SaaS and `CLEARSTORY` marks exist in construction software and video. Different classes
   and different spelling on the strongest marks, but that is a lawyer's call and it is cheap relative to a rebrand.
9. **Rewrite the home page copy to the five voice rules regardless of the visual outcome.** It is free, it is
   independent of every other decision here, and the current page is written for agents while the product is built for
   a photographer.
10. **Record the outcome in `DECISIONS.md` as a superseding entry, not an edit.** The 2026-08-29 and 2026-08-31 brand
    entries contain the reasoning that led here and are worth keeping legible. Also fix the drift: `UI-SPEC.md:360`
    currently asserts "serif display, humanist sans UI, 2–3px radii," which the shipped CSS does not do. Either the
    spec or the code is wrong, and right now the spec is lying.

---

## Sources

Competitor sites (fetched 2026-09-03): [BoxBrownie](https://www.boxbrownie.com/) ·
[Styldod](https://www.styldod.com/) · [Virtual Staging AI](https://www.virtualstagingai.app/) ·
[REimagine Home](https://www.reimaginehome.ai/) · [Collov](https://collov.ai/) · [PhotoUp](https://www.photoup.net/) ·
[Autoenhance.ai](https://www.autoenhance.ai/) · [Pixlmob](https://www.pixlmob.com/) ·
[HomeJab](https://www.homejab.com/) · [Photoroom](https://www.photoroom.com/)

Search-sourced (host returned 403 or no home content): [Aftershoot](https://aftershoot.com/) ·
[Aftershoot pricing](https://aftershoot.com/blog/aftershoot-pricing/) ·
[Imagen AI pricing](https://filterpixel.com/imagen-ai-pricing) ·
[Imagen AI editing costs](https://imagen-ai.com/valuable-tips/how-much-does-photo-editing-cost/) ·
[Fotello pricing](https://fotello.co/pricing) · [Fotello features](https://fotello.co/features/photos) ·
[Fstoppers on Fotello](https://fstoppers.com/architecture/testing-fotello-ai-software-edits-real-estate-photos-719419) ·
[Pixieset](https://pixieset.com/) · [Pixieset pricing](https://pixieset.com/pricing/)

Name collision checks: [Clerestory SaaS](https://www.clerestory.app/brands) ·
[Clerestory Consulting profile](https://pitchbook.com/profiles/advisor/266726-44) ·
[CLEARSTORY trademark](https://uspto.report/TM/98061772) · [Contact Sheet App](https://contactsheet.app/) ·
[Northlight Stills & Motion, RE photography](https://www.northlightstillsandmotion.com/realestatephotography) ·
[NORTH / LIGHT Studios](https://www.northlight.studio/photo)

Domain availability: Vercel registrar API, 23 domains across 8 batches, 2026-09-03.
