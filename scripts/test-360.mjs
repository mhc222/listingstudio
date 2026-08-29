// Phase 17 live test: 360 edits end to end against local dev. Run once, then delete.
// node scripts/test-360.mjs
import { readFileSync } from "node:fs"
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

// 2. find the test listing + a non-pano photo
const listings = await rest(`listings?select=id,address&order=created_at`)
const listing = listings.find((l) => l.address.includes("Smith")) ?? listings[0]
console.log("listing:", listing.address, listing.id)
const flats = await rest(
  `photos?select=id,width,height&listing_id=eq.${listing.id}&is_floor_plan=eq.false&order=created_at&limit=5`
)
const flat = flats.find((p) => p.width && Math.abs(p.width / p.height - 2) > 0.1)

// 3. synthetic 3200x1600 pano with yaw markers + a "clutter" box to remove later
const marks = Array.from({ length: 8 }, (_, i) => {
  const x = (i * 3200) / 8
  return `<rect x="${x}" y="700" width="4" height="200" fill="#333"/><text x="${x + 10}" y="820" font-size="60" fill="#333">${i * 45}°</text>`
}).join("")
const panoBuf = await sharp(
  Buffer.from(
    `<svg width="3200" height="1600" xmlns="http://www.w3.org/2000/svg">
      <rect width="3200" height="800" fill="#a8c8e8"/>
      <rect y="800" width="3200" height="800" fill="#c8b89a"/>
      ${marks}
      <rect x="1400" y="1100" width="300" height="200" fill="#7a2020"/>
      <text x="1410" y="1220" font-size="48" fill="#fff">BOX</text>
    </svg>`
  )
)
  .jpeg({ quality: 90 })
  .toBuffer()

const form = new FormData()
form.set("listingId", listing.id)
form.append("files", new File([panoBuf], "test-pano-360.jpg", { type: "image/jpeg" }))
const upRes = await fetch(`${APP}/api/upload`, { method: "POST", headers: { Cookie: cookie }, body: form })
const upJson = await upRes.json()
if (!upRes.ok) throw new Error("upload failed: " + JSON.stringify(upJson))
const panoId = upJson.uploaded?.[0]
console.log("pano uploaded:", panoId, JSON.stringify(upJson).slice(0, 200))

async function postJob(body) {
  const res = await fetch(`${APP}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

// 4. negative tests
if (flat) {
  const r = await postJob({
    listingId: listing.id,
    photoId: flat.id,
    editChain: [{ edit_type: "360_IMAGE_ENHANCEMENT", options: {} }],
  })
  console.log("non-pano input →", r.status, r.json.error)
}
const mixed = await postJob({
  listingId: listing.id,
  photoId: panoId,
  editChain: [
    { edit_type: "360_IMAGE_ENHANCEMENT", options: {} },
    { edit_type: "TURN_ON_LIGHTS", options: {} },
  ],
})
console.log("mixed chain →", mixed.status, mixed.json.error)
const samples = await rest(`sample_images?select=id&limit=1`)
if (samples[0]) {
  const r = await postJob({
    listingId: listing.id,
    photoId: panoId,
    editChain: [{ edit_type: "360_IMAGE_ENHANCEMENT", options: {} }],
    sampleImageIds: [samples[0].id],
  })
  console.log("with refs →", r.status, r.json.error)
}

// 5. the real job
const job = await postJob({
  listingId: listing.id,
  photoId: panoId,
  editChain: [{ edit_type: "360_IMAGE_ENHANCEMENT", options: {} }],
  comment: "keep the degree markers readable",
})
if (job.status !== 200) throw new Error("job create failed: " + JSON.stringify(job.json))
const fgId = job.json.fileGroupIds[0]
console.log("job submitted:", job.json.jobId, "fg:", fgId)

// verify provider + fal request carried image_size (provider column check)
const fgRow0 = await rest(`file_groups?select=provider,step_status&id=eq.${fgId}`)
console.log("provider:", fgRow0[0].provider, "status:", fgRow0[0].step_status)

// 6. poll reconcile (localhost completion path)
const deadline = Date.now() + 240_000
let fg
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 12_000))
  await fetch(`${APP}/api/cron/reconcile?all=1`)
  ;[fg] = await rest(`file_groups?select=step_status,current_step,last_error&id=eq.${fgId}`)
  console.log("  …", fg.step_status, fg.last_error ?? "")
  if (["complete", "failed"].includes(fg.step_status)) break
}
if (fg.step_status !== "complete") throw new Error("did not complete: " + JSON.stringify(fg))

// 7. verify output: dims, qa_note, ledger
const [ver] = await rest(
  `output_versions?select=id,storage_path,qa_note&file_group_id=eq.${fgId}&order=version_number.desc&limit=1`
)
console.log("qa_note:", ver.qa_note)
const signRes = await fetch(`${URL_}/storage/v1/object/sign/outputs/${ver.storage_path}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
  body: JSON.stringify({ expiresIn: 600 }),
})
const { signedURL } = await signRes.json()
const outBuf = Buffer.from(await (await fetch(`${URL_}/storage/v1${signedURL}`)).arrayBuffer())
const meta = await sharp(outBuf).metadata()
console.log("output dims:", meta.width, "x", meta.height, "(expect 3200x1600)")
const ledger = await rest(`spend_ledger?select=kind,cost_cents,model&file_group_id=eq.${fgId}`)
console.log("ledger:", JSON.stringify(ledger))
console.log(
  meta.width === 3200 && meta.height === 1600 && ver.qa_note?.includes("seam") && ledger.length === 1
    ? "PHASE 17 LIVE TEST: PASS"
    : "PHASE 17 LIVE TEST: CHECK FAILURES ABOVE"
)
