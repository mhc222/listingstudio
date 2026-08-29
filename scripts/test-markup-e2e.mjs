// Phase 23 live test: markup-to-edit end to end against local dev.
// node scripts/test-markup-e2e.mjs   (~4-8¢: one gemini generation + QA)
import { readFileSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import sharp from "sharp"

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const SR = env.SUPABASE_SERVICE_ROLE_KEY
const APP = "http://localhost:3000"
const ref = new URL(URL_).hostname.split(".")[0]
const OUT_DIR = process.env.MARKUP_OUT_DIR ?? "."

const admin = createClient(URL_, SR)
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, ...init.headers },
  })
  return res.json()
}

// 1. mint session cookie
const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: "mhc222@gmail.com",
})
if (linkErr) throw linkErr
const { data: sess, error: otpErr } = await anon.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
})
if (otpErr) throw otpErr
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(sess.session)).toString("base64url")}`
console.log("session minted")

// 2. the phase-13 living-room photo on 123 Smith Street
const PHOTO = "93bb2736-e33f-4caa-979d-c0bc3db58c57"
const [photo] = await rest(`photos?id=eq.${PHOTO}&select=listing_id,storage_path,width,height`)
if (!photo) throw new Error("test photo missing")
const listingId = photo.listing_id
const srcBuf = Buffer.from(
  await (
    await fetch(`${URL_}/storage/v1/object/authenticated/originals/${photo.storage_path}`, {
      headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    })
  ).arrayBuffer()
)
const srcHash = (await import("node:crypto")).createHash("sha256").update(srcBuf).digest("hex")

// 3. marked-up copy (same marks as the gate experiment) through /api/markup
const marksSvg = `<svg width="${photo.width}" height="${photo.height}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="650" cy="420" r="190" fill="none" stroke="#0033FF" stroke-width="10"/>
  <rect x="690" y="700" width="300" height="170" fill="none" stroke="#FF0000" stroke-width="10"/>
</svg>`
const markedPng = await sharp(srcBuf).composite([{ input: Buffer.from(marksSvg) }]).png().toBuffer()
const form = new FormData()
form.append("file", new File([markedPng], "markup.png", { type: "image/png" }))
const mkRes = await fetch(`${APP}/api/markup`, {
  method: "POST",
  headers: { Cookie: cookie },
  body: form,
})
const mk = await mkRes.json()
if (!mkRes.ok || !mk.path) throw new Error(`markup upload failed: ${JSON.stringify(mk)}`)
console.log("markup uploaded:", mk.path)

async function postJob(body) {
  const res = await fetch(`${APP}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ listingId, photoIds: [PHOTO], ...body }),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}

// 4. negative tests
const chained = await postJob({
  editChain: [
    { edit_type: "MARKUP_EDIT", options: { markup_path: mk.path, remove_count: 1 } },
    { edit_type: "IMAGE_ENHANCEMENT", options: {} },
  ],
})
if (chained.status !== 400 || !chained.data.error.includes("runs alone"))
  throw new Error(`FAIL chained markup: ${chained.status} ${JSON.stringify(chained.data)}`)
console.log("chained markup rejected 400 ✓")

const noPath = await postJob({ editChain: [{ edit_type: "MARKUP_EDIT", options: {} }] })
if (noPath.status !== 400 || !noPath.data.error.includes("attached markup"))
  throw new Error(`FAIL missing markup_path: ${noPath.status} ${JSON.stringify(noPath.data)}`)
console.log("missing markup_path rejected 400 ✓")

// 5. the real job
const job = await postJob({
  editChain: [
    {
      edit_type: "MARKUP_EDIT",
      options: { markup_path: mk.path, remove_count: 1, replace_count: 1 },
    },
  ],
  comment: "replace the boxed coffee table with a rustic solid-wood coffee table",
})
if (job.status !== 200) throw new Error(`job create failed: ${JSON.stringify(job.data)}`)
const fgId = job.data.fileGroupIds[0]
console.log("job created:", job.data.jobId, "fg:", fgId)

// 6. drive to completion via reconcile (fal can't webhook localhost)
const t0 = Date.now()
let fg
for (;;) {
  await new Promise((r) => setTimeout(r, 10_000))
  await fetch(`${APP}/api/cron/reconcile?all=1`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  })
  ;[fg] = await rest(
    `file_groups?id=eq.${fgId}&select=step_status,current_step,edit_chain,provider,last_error`
  )
  const total = fg.edit_chain.length
  console.log(
    `t+${Math.round((Date.now() - t0) / 1000)}s: ${fg.step_status} step ${fg.current_step + 1}/${total}`
  )
  if (fg.step_status === "failed") throw new Error(`fg failed: ${fg.last_error}`)
  if (fg.step_status === "complete" && fg.current_step === total - 1) break
  if (Date.now() - t0 > 300_000) throw new Error("timeout")
}
if (fg.provider !== "gemini") throw new Error(`FAIL provider ${fg.provider}, expected gemini`)
console.log("provider gemini ✓")

// 7. verify: version + qa note, ledger rows, original untouched, no marks in output
const versions = await rest(
  `output_versions?file_group_id=eq.${fgId}&select=version_number,storage_path,qa_note&order=version_number.desc`
)
if (!versions.length) throw new Error("no output version")
console.log(`version v${versions[0].version_number}, qa_note: ${versions[0].qa_note}`)

const ledger = await rest(
  `spend_ledger?file_group_id=eq.${fgId}&select=kind,model,cost_cents,edit_type`
)
console.log("ledger:", ledger.map((l) => `${l.kind} ${l.model} ${l.cost_cents}¢`).join(" | "))
if (!ledger.some((l) => l.kind === "generation" && l.edit_type === "MARKUP_EDIT"))
  throw new Error("FAIL: no generation ledger row")

const srcAgain = Buffer.from(
  await (
    await fetch(`${URL_}/storage/v1/object/authenticated/originals/${photo.storage_path}`, {
      headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    })
  ).arrayBuffer()
)
const againHash = (await import("node:crypto")).createHash("sha256").update(srcAgain).digest("hex")
if (againHash !== srcHash) throw new Error("FAIL: original photo bytes changed")
console.log("original untouched ✓")

const outBuf = Buffer.from(
  await (
    await fetch(`${URL_}/storage/v1/object/authenticated/outputs/${versions[0].storage_path}`, {
      headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    })
  ).arrayBuffer()
)
writeFileSync(`${OUT_DIR}/markup-e2e-out.jpg`, outBuf)
const { data, info } = await sharp(outBuf).raw().toBuffer({ resolveWithObject: true })
let blue = 0
let red = 0
for (let i = 0; i < data.length; i += info.channels) {
  const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
  if (b > 140 && b - r > 60 && b - g > 60) blue++
  if (r > 140 && r - g > 60 && r - b > 60) red++
}
console.log(`output mark-color pixels: blue=${blue} red=${red}`)
if (blue > 500 || red > 500) throw new Error("FAIL: marks leaked into the output")
console.log("PASS: markup-to-edit end to end")
