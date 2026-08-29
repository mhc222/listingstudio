// Verify the gemini ref-aspect fix (DECISIONS 2026-08-29): a ref letterboxed
// to the primary's aspect must yield an output at the PRIMARY's aspect.
// Baseline (measured twice): primary 1600x1000 + raw ref 1600x2400 → 832x1248.
// One sync gemini call (~$0.039). node scripts/test-ref-aspect.mjs
import { readFileSync } from "node:fs"
import sharp from "sharp"

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const SR = env.SUPABASE_SERVICE_ROLE_KEY

const PRIMARY = "93bb2736-e33f-4caa-979d-c0bc3db58c57"
const REF = "aadb20b0-6885-487b-9e0f-1f1a0a9e90ee"

const rows = await (
  await fetch(
    `${URL_}/rest/v1/photos?id=in.(${PRIMARY},${REF})&select=id,storage_path,width,height`,
    { headers: { apikey: SR, Authorization: `Bearer ${SR}` } }
  )
).json()
const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
console.log("primary:", byId[PRIMARY].width, "x", byId[PRIMARY].height)
console.log("ref:", byId[REF].width, "x", byId[REF].height)

async function download(path) {
  const res = await fetch(`${URL_}/storage/v1/object/authenticated/originals/${path}`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  })
  if (!res.ok) throw new Error(`storage download failed (${res.status}): ${path}`)
  return Buffer.from(await res.arrayBuffer())
}

const primaryBuf = await download(byId[PRIMARY].storage_path)
const refBuf = await download(byId[REF].storage_path)

// same padding math as padRefsToPrimaryAspect in lib/imaging.ts
const pm = await sharp(primaryBuf).metadata()
const target = pm.width / pm.height
const MAX = 1536
const [w, h] =
  target >= 1 ? [MAX, Math.round(MAX / target)] : [Math.round(MAX * target), MAX]
const padded = await sharp(refBuf)
  .resize(w, h, { fit: "contain", background: { r: 128, g: 128, b: 128 } })
  .jpeg({ quality: 90 })
  .toBuffer()
console.log(`padded ref to ${w}x${h} (target aspect ${target.toFixed(3)})`)

const toUri = (b) => `data:image/jpeg;base64,${b.toString("base64")}`
const t0 = Date.now()
const res = await fetch("https://fal.run/fal-ai/gemini-25-flash-image/edit", {
  method: "POST",
  headers: { Authorization: `Key ${env.FAL_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt:
      "Bright, warmly lit real estate photo of this exact room. Turn on only the light fixtures that already exist in the first image, and add no new fixtures of any kind; every existing fixture emits a warm inviting glow. The second image is a lighting style reference only. Do not alter room dimensions, wall positions, window or door placement, flooring, ceiling height, or camera perspective. wide-angle real estate listing photography, inviting and spacious.",
    image_urls: [toUri(primaryBuf), toUri(padded)],
  }),
})
if (!res.ok) throw new Error(`fal call failed (${res.status}): ${await res.text()}`)
const data = await res.json()
const outUrl = data.images?.[0]?.url ?? data.image?.url
console.log(`fal returned in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

const out = await sharp(
  Buffer.from(await (await fetch(outUrl)).arrayBuffer())
).metadata()
const outAspect = out.width / out.height
console.log(`output: ${out.width}x${out.height} (aspect ${outAspect.toFixed(3)})`)

// baseline bug returned 832x1248 (aspect 0.667); primary aspect is 1.600
if (out.width <= out.height) throw new Error("FAIL: output is portrait — ref aspect still leaking")
if (Math.abs(outAspect - target) / target > 0.1)
  throw new Error(`FAIL: output aspect ${outAspect.toFixed(3)} vs primary ${target.toFixed(3)}`)
console.log("PASS: output follows the primary's aspect with a padded ref")
