// Phase 23 gate experiment (~$0.06): do colored markup annotations leak into
// qwen / gemini output? Blue circle (remove the lamp) + red rectangle (replace
// the coffee table) composited on the phase-13 living-room photo, one sync
// call per provider, then a pixel scan for the mark colors.
// node scripts/test-markup.mjs
import { readFileSync, writeFileSync } from "node:fs"
import sharp from "sharp"

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const SR = env.SUPABASE_SERVICE_ROLE_KEY
const OUT_DIR = process.env.MARKUP_OUT_DIR ?? "."

const PHOTO = "93bb2736-e33f-4caa-979d-c0bc3db58c57" // 1600x1000 living room

const rows = await (
  await fetch(`${URL_}/rest/v1/photos?id=eq.${PHOTO}&select=storage_path,width,height`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  })
).json()
const src = Buffer.from(
  await (
    await fetch(`${URL_}/storage/v1/object/authenticated/originals/${rows[0].storage_path}`, {
      headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    })
  ).arrayBuffer()
)
const { width: W, height: H } = rows[0]

// marks: pure mark colors, thick strokes — same shapes phase 23 will draw
const marks = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="650" cy="420" r="190" fill="none" stroke="#0033FF" stroke-width="10"/>
  <rect x="690" y="700" width="300" height="170" fill="none" stroke="#FF0000" stroke-width="10"/>
</svg>`
const marked = await sharp(src)
  .composite([{ input: Buffer.from(marks) }])
  .jpeg({ quality: 92 })
  .toBuffer()
writeFileSync(`${OUT_DIR}/markup-input.jpg`, marked)

const PROMPT =
  "The colored markings drawn on this image are editing instructions only: " +
  "the blue circle marks an item to remove entirely (fill the space naturally with matching wall and floor); " +
  "the red rectangle marks an item to replace with a rustic solid-wood coffee table. " +
  "Do not render the blue circle, the red rectangle, or any colored markings in the output. " +
  "Do not alter room dimensions, wall positions, window or door placement, flooring, ceiling height, or camera perspective. " +
  "wide-angle real estate listing photography, inviting and spacious."

// pixel scan: count strongly-blue / strongly-red pixels
async function markPixels(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  let blue = 0
  let red = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    if (b > 140 && b - r > 60 && b - g > 60) blue++
    if (r > 140 && r - g > 60 && r - b > 60) red++
  }
  return { blue, red }
}

const uri = `data:image/jpeg;base64,${marked.toString("base64")}`
async function runProvider(name, url, body) {
  const t0 = Date.now()
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Key ${env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${name} failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  const outUrl = data.images?.[0]?.url ?? data.image?.url
  const out = Buffer.from(await (await fetch(outUrl)).arrayBuffer())
  writeFileSync(`${OUT_DIR}/markup-out-${name}.jpg`, out)
  const px = await markPixels(out)
  console.log(
    `${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s  blue=${px.blue} red=${px.red}`
  )
  return px
}

const base = await markPixels(src)
const input = await markPixels(marked)
console.log(`clean original: blue=${base.blue} red=${base.red}`)
console.log(`marked input:   blue=${input.blue} red=${input.red}`)

const qwen = await runProvider("qwen", "https://fal.run/fal-ai/qwen-image-edit", {
  prompt: PROMPT,
  image_url: uri,
})
const gemini = await runProvider(
  "gemini",
  "https://fal.run/fal-ai/gemini-25-flash-image/edit",
  { prompt: PROMPT, image_urls: [uri] }
)

// leak = mark-color pixels well above the clean original's baseline
const LEAK = 500
for (const [name, px] of [
  ["qwen", qwen],
  ["gemini", gemini],
]) {
  const leaked = px.blue - base.blue > LEAK || px.red - base.red > LEAK
  console.log(`${name}: ${leaked ? "LEAKED — marks visible in output" : "clean (no mark leakage)"}`)
}
