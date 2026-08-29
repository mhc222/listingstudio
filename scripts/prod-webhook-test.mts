// One-shot phase-16 verification: run a cheap ITEM_REMOVAL job on PROD and
// confirm the state machine completes via the signed fal webhook (not reconcile).
// Run: npx tsx scripts/prod-webhook-test.mts   (delete after phase 16)
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const PROD = "https://listing-studio-three.vercel.app"

const env: Record<string, string> = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2]
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

// mint a session
const { data: users } = await admin.auth.admin.listUsers()
const email = users.users[0].email!
const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email })
if (linkErr) throw linkErr
const { data: otp, error: otpErr } = await anon.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
})
if (otpErr) throw otpErr
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]
const cookie = `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(otp.session)).toString("base64url")}`

// pick a non-floor-plan photo on the demo listing
const { data: photos } = await admin
  .from("photos")
  .select("id, listing_id, is_floor_plan")
  .eq("is_floor_plan", false)
  .limit(1)
if (!photos?.length) throw new Error("no photo found")
const { id: photoId, listing_id: listingId } = photos[0]
console.log("photo:", photoId, "listing:", listingId)

// create the job against PROD
const res = await fetch(`${PROD}/api/jobs`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({
    listingId,
    photoId,
    editChain: [{ edit_type: "ITEM_REMOVAL", options: { tier: 1, items: "any small clutter" } }],
    comment: "phase 16 prod webhook verification",
  }),
})
const created = await res.json()
console.log("POST /api/jobs:", res.status, JSON.stringify(created))
if (!res.ok) process.exit(1)
const jobId = created.jobId ?? created.job?.id ?? created.id

// poll the DB every 10s, up to 3 min. Webhook completion should land well
// under the reconcile cron's 3-minute stuck cutoff — completion before ~3min
// of step runtime proves the webhook path.
const t0 = Date.now()
for (;;) {
  await new Promise((r) => setTimeout(r, 10_000))
  const { data: fgs } = await admin
    .from("file_groups")
    .select("id, status, step_status, current_step, fal_request_id, last_error, retry_count")
    .eq("job_id", jobId)
  const fg = fgs?.[0]
  const secs = Math.round((Date.now() - t0) / 1000)
  console.log(`t+${secs}s`, JSON.stringify(fg))
  if (!fg) continue
  if (fg.status === "complete") {
    console.log(secs < 170 ? "COMPLETED FAST — webhook path proven" : "completed but slow — may have been reconcile")
    const { data: ledger } = await admin.from("spend_ledger").select("kind, cost_cents, model").eq("job_id", jobId)
    console.log("ledger:", JSON.stringify(ledger))
    process.exit(0)
  }
  if (fg.status === "failed") {
    console.log("FAILED:", fg.last_error)
    process.exit(1)
  }
  if (secs > 240) {
    console.log("TIMEOUT — still not complete after 4 min (reconcile should have rescued it; investigate)")
    process.exit(1)
  }
}
