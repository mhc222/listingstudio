// Phase 57 manual test, automated with Playwright against a running dev server.
// Steps mirror PLAN.md "Manual test (Matt)": 10-photo drop → placeholders → 202 finalize
// timings → real thumbs; 5-photo drop + close tab → reopen; forced stuck row → cron.
//
// Run:  npm run e2e:background-uploads   (dev server on :3000, .env.local present)
// Needs the global Playwright install (`playwright` on PATH with Chromium cached);
// it is deliberately not a repo dependency. Signs in by minting a magic-link session
// for E2E_EMAIL (default: the most recently signed-in non-".test" user) with the
// service role, creates a fresh "Phase 57 e2e" listing, and writes 15 photos to the
// live project. ROUND1_ONLY=1 stops after the 10-photo round.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createClient } from "@supabase/supabase-js"
import sharp from "sharp"

const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim()
const { chromium } = await import(pathToFileURL(path.join(globalRoot, "playwright", "index.mjs")).href)

const REPO = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")
const PHOTOS = fs.mkdtempSync(path.join(os.tmpdir(), "phase57-photos-"))
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), "phase57-shots-"))
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000"

const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")] })
)
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0]
const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const results = []
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function b64url(s) { return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }
function sessionCookies(session) {
  const value = "base64-" + b64url(JSON.stringify(session))
  const name = `sb-${projectRef}-auth-token`
  const MAX = 3180
  const base = { domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }
  if (value.length <= MAX) return [{ name, value, ...base }]
  const chunks = []
  for (let i = 0; i * MAX < value.length; i++) chunks.push({ name: `${name}.${i}`, value: value.slice(i * MAX, (i + 1) * MAX), ...base })
  return chunks
}

async function mintSession() {
  const { data: users, error } = await admin.auth.admin.listUsers({ perPage: 50 })
  if (error) throw error
  const candidates = users.users.filter((u) => !u.email.endsWith(".test")).sort((a, b) => (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? ""))
  const user = process.env.E2E_EMAIL ? users.users.find((u) => u.email === process.env.E2E_EMAIL) : candidates[0]
  if (!user) throw new Error("no auth user found")
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email })
  if (linkErr) throw linkErr
  const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error: otpErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" })
  if (otpErr) throw otpErr
  return { user, session: data.session }
}

function trackRequests(page, store) {
  page.on("request", (req) => {
    const url = req.url()
    if (url.startsWith(BASE + "/api/uploads") || url.includes("/storage/v1/upload/resumable")) {
      store.push({ url, method: req.method(), start: Date.now(), status: null, end: null })
    }
  })
  page.on("response", async (res) => {
    const req = res.request()
    const rec = store.find((r) => r.url === req.url() && r.method === req.method() && r.status === null)
    if (rec) { rec.status = res.status(); rec.end = Date.now() }
  })
}
const summarize = (reqs) => {
  const groups = {}
  for (const r of reqs) {
    let key
    if (r.url.includes("/storage/v1/upload/resumable")) key = `TUS ${r.method}`
    else if (/\/api\/uploads\/[^/]+\/finalize$/.test(r.url)) key = "finalize POST"
    else if (/\/api\/uploads\/[^/]+\/authorize$/.test(r.url)) key = "authorize POST"
    else if (r.url.endsWith("/api/uploads/prepare")) key = "prepare POST"
    else if (r.url.includes("/api/uploads?")) key = "status GET"
    else key = `${r.method} ${new URL(r.url).pathname}`
    ;(groups[key] ??= []).push(r)
  }
  return groups
}

async function pendingCount(page) { return page.locator("[data-upload-placeholder]").count() }
async function realCount(page) { return page.locator('[role="checkbox"][aria-label*="selection"]').count() }

async function waitFor(fn, pred, timeoutMs, label) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < timeoutMs) { last = await fn(); if (pred(last)) return { value: last, ms: Date.now() - t0 }; await sleep(50) }
  throw new Error(`timeout waiting for ${label} (last=${JSON.stringify(last)})`)
}

async function makePhotos() {
  const src = path.join(REPO, "public/hero.jpg")
  for (let i = 1; i <= 15; i++) {
    await sharp(src).modulate({ brightness: 1 + (i % 5) * 0.02 }).jpeg({ quality: 88 }).toFile(path.join(PHOTOS, `test-${String(i).padStart(2, "0")}.jpg`))
  }
}

async function main() {
  await makePhotos()
  const { user, session } = await mintSession()
  console.log(`signed in as ${user.email}`)
  const { data: listing, error } = await admin.from("listings").insert({ user_id: user.id, address: `Phase 57 e2e ${new Date().toISOString()}` }).select("id").single()
  if (error) throw error
  const listingUrl = `${BASE}/listings/${listing.id}`
  console.log(`test listing ${listingUrl}`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addCookies(sessionCookies(session))
  const files = (n, offset = 0) => Array.from({ length: n }, (_, i) => path.join(PHOTOS, `test-${String(i + 1 + offset).padStart(2, "0")}.jpg`))

  // ---- Round 1: 10 photos ----
  let page = await context.newPage()
  const reqs1 = []
  trackRequests(page, reqs1)
  await page.goto(listingUrl, { waitUntil: "networkidle" })
  ok("listing page loads signed in", !page.url().includes("/login"), page.url())
  const input = page.locator("#upload-queue input[type=file]").first()
  await page.evaluate(() => {
    window.__ph = { change: null, ten: null }
    document.querySelector("#upload-queue input[type=file]").addEventListener("change", () => { window.__ph.change = performance.now() }, { once: true })
    new MutationObserver(() => { if (window.__ph.ten === null && document.querySelectorAll("[data-upload-placeholder]").length >= 10) window.__ph.ten = performance.now() }).observe(document.body, { childList: true, subtree: true, attributes: true })
  })
  await input.setInputFiles(files(10))
  const ph = await waitFor(() => pendingCount(page), (n) => n >= 10, 5000, "10 placeholder tiles").catch((e) => ({ error: e.message }))
  ok("10 placeholder tiles appear within 1 s", !ph.error && ph.ms <= 1000, ph.error ?? `${ph.value} tiles after ${ph.ms} ms`)
  const inPage = await page.evaluate(() => window.__ph)
  const prep = reqs1.find((r) => r.url.endsWith("/api/uploads/prepare"))
  console.log(`in-page: input change → 10 tiles = ${Math.round(inPage.ten - inPage.change)} ms; prepare POST took ${prep ? prep.end - prep.start : "?"} ms`)
  const noticeVisible = await page.getByText(/background/i).first().isVisible().catch(() => false)
  ok("background-upload notice shown", noticeVisible)
  await page.screenshot({ path: path.join(SHOTS, "round1-placeholders.png"), fullPage: true })

  const done1 = await waitFor(async () => ({ real: await realCount(page), pending: await pendingCount(page) }), (s) => s.real >= 10 && s.pending === 0, 120000, "10 real tiles, 0 placeholders").catch((e) => ({ error: e.message }))
  ok("real thumbs replace placeholders without a click", !done1.error, done1.error ?? `${done1.value.real} real / ${done1.value.pending} pending after ${(done1.ms / 1000).toFixed(1)} s from drop`)
  await page.screenshot({ path: path.join(SHOTS, "round1-final.png"), fullPage: true })

  const g1 = summarize(reqs1)
  const fin = g1["finalize POST"] ?? []
  const finLat = fin.map((r) => r.end - r.start)
  ok("exactly 10 finalize POSTs", fin.length === 10, `${fin.length}`)
  ok("finalize responds 202", fin.every((r) => r.status === 202), fin.map((r) => r.status).join(","))
  ok("finalize latency well under 1 s", finLat.length && Math.max(...finLat) < 1000, `max ${Math.max(...finLat)} ms, median ${[...finLat].sort((a, b) => a - b)[Math.floor(finLat.length / 2)]} ms`)
  ok("no /authorize calls", !(g1["authorize POST"]?.length), `${g1["authorize POST"]?.length ?? 0}`)
  ok("one prepare per batch", (g1["prepare POST"] ?? []).length === 1, `${(g1["prepare POST"] ?? []).length}`)
  const tusPost = (g1["TUS POST"] ?? []).length, tusPatch = (g1["TUS PATCH"] ?? []).length, tusHead = (g1["TUS HEAD"] ?? []).length
  ok("per photo: 1 TUS creation + 1 finalize (PATCH chunks separate)", tusPost === 10 && fin.length === 10, `TUS POST ${tusPost}, PATCH ${tusPatch}, HEAD ${tusHead}, finalize ${fin.length}`)
  console.log("round 1 request groups:", Object.fromEntries(Object.entries(g1).map(([k, v]) => [k, v.length])))
  await page.close()
  if (process.env.ROUND1_ONLY) { await browser.close(); console.log("round 1 only; listing " + listingUrl); process.exit(results.some((r) => !r.pass) ? 1 : 0) }

  // ---- Round 2: 5 photos, close tab right after transfers finish ----
  page = await context.newPage()
  const reqs2 = []
  trackRequests(page, reqs2)
  await page.goto(listingUrl, { waitUntil: "networkidle" })
  const before2 = await realCount(page)
  await page.locator("#upload-queue input[type=file]").first().setInputFiles(files(5, 10))
  // "right after the drop finishes transferring" = all 5 finalize POSTs have been answered
  const fin2 = await waitFor(() => reqs2.filter((r) => /\/finalize$/.test(r.url) && r.end), (a) => a.length >= 5, 60000, "5 finalize responses")
  const stillPending = await pendingCount(page)
  await page.close()
  console.log(`round 2: closed tab ${fin2.ms} ms after drop, ${stillPending} tiles still pending at close`)
  await sleep(20000)
  page = await context.newPage()
  await page.goto(listingUrl, { waitUntil: "networkidle" })
  const after2 = await waitFor(() => realCount(page), (n) => n >= before2 + 5, 15000, "15 real tiles after reopen").catch((e) => ({ error: e.message }))
  ok("reopen after 20 s: all 5 photos present", !after2.error, after2.error ?? `${after2.value} tiles (was ${before2})`)
  const { data: rows } = await admin.from("upload_items").select("id, status, error, photo_id, batch_id").in("batch_id", (await admin.from("upload_batches").select("id").eq("listing_id", listing.id)).data.map((b) => b.id))
  const byStatus = rows.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})
  ok("no upload_items stuck (all 15 complete)", rows.length === 15 && rows.every((r) => r.status === "complete"), JSON.stringify(byStatus))
  ok("placeholders gone after reopen", (await pendingCount(page)) === 0)
  await page.screenshot({ path: path.join(SHOTS, "round2-reopened.png"), fullPage: true })
  await page.close()

  // ---- Round 3: force a stuck row, hit the cron ----
  const victim = rows.find((r) => r.status === "complete")
  const stale = new Date(Date.now() - 10 * 60_000).toISOString()
  const { error: forceErr } = await admin.from("upload_items").update({ status: "finalizing", updated_at: stale }).eq("id", victim.id)
  if (forceErr) throw forceErr
  const cron = await fetch(`${BASE}/api/cron/reconcile`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } })
  const cronBody = await cron.json()
  const outcome = cronBody.uploads?.finalizing?.[victim.id]
  const { data: afterRow } = await admin.from("upload_items").select("status, error, photo_id").eq("id", victim.id).single()
  ok("cron reports the stuck row", cron.status === 200 && outcome !== undefined, `HTTP ${cron.status}, outcome=${outcome}, staleFinalizing=${cronBody.uploads?.staleFinalizing}`)
  ok("stuck row is completed or failed, never left finalizing", afterRow.status !== "finalizing", `status=${afterRow.status}${afterRow.error ? " error=" + afterRow.error : ""}`)

  await browser.close()
  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${SHOTS}. Test listing left in place: ${listingUrl}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => { console.error("E2E crashed:", e); process.exit(2) })
