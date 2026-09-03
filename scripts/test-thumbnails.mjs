// Phase 56 image weight. Unit-tests thumb path mapping, the thumb/source
// fallback merge, signed-URL expiry quantization, the per-window memo, and the
// storage wrapper's batch signing against a counted mock Supabase client. Also
// renders one real thumb through sharp to pin width, orientation, and weight.
import assert from "node:assert/strict"
import sharp from "sharp"
import { isThumbPath, mergeThumbUrls, renderThumb, thumbPathFor, THUMB_WIDTH } from "../lib/thumbs.ts"
import { SignedUrlCache, signedUrlWindow } from "../lib/signed-urls.ts"
import { getThumbUrls, getUrl, getUrls } from "../lib/storage.ts"

let assertions = 0
const check = (fn) => { fn(); assertions += 1 }
const eq = (a, b, m) => check(() => assert.equal(a, b, m))
const ok = (v, m) => check(() => assert.ok(v, m))

// --- path mapping -----------------------------------------------------------
eq(thumbPathFor("u/l/p/source.jpg"), "u/l/p/thumb.jpg", "original source maps to sibling thumb.jpg")
eq(thumbPathFor("u/l/p/source.heic"), "u/l/p/thumb.jpg", "HEIC source shares the photo's single thumb")
eq(thumbPathFor("u/l/p/canonical.jpg"), "u/l/p/thumb.jpg", "rotated canonical shares the photo's single thumb")
eq(thumbPathFor("u/l/p/source.pdf"), "u/l/p/thumb.jpg", "PDF plan maps to a thumb path that simply never exists")
eq(thumbPathFor("fg/step-0-r0.jpg"), "fg/step-0-r0.thumb.jpg", "output versions keep their stem (many per folder)")
eq(thumbPathFor("fg/step-1-r2.jpg"), "fg/step-1-r2.thumb.jpg", "retry outputs stay distinct")
eq(thumbPathFor("u/l/p/markup-abc.png"), "u/l/p/markup-abc.thumb.jpg", "non-solo stems keep their stem")
eq(thumbPathFor("noext"), "noext.thumb.jpg", "extensionless path still maps")
eq(thumbPathFor("u/l/p/thumb.jpg"), "u/l/p/thumb.jpg", "thumb of a thumb is itself")
eq(thumbPathFor("fg/step-0-r0.thumb.jpg"), "fg/step-0-r0.thumb.jpg", "output thumb is idempotent")
ok(isThumbPath("u/l/p/thumb.jpg") && isThumbPath("fg/step-0-r0.thumb.jpg"), "isThumbPath recognises both shapes")
ok(!isThumbPath("u/l/p/source.jpg") && !isThumbPath("fg/step-0-r0.jpg"), "isThumbPath rejects sources")
ok(thumbPathFor("u/l/a/source.jpg") !== thumbPathFor("u/l/b/source.jpg"), "different photos never collide")

// --- fallback merge ---------------------------------------------------------
{
  const merged = mergeThumbUrls(
    ["a/source.jpg", "b/source.jpg", "c/source.jpg"],
    { "a/thumb.jpg": "T-a" },
    { "b/source.jpg": "S-b" }
  )
  eq(merged["a/source.jpg"], "T-a", "thumb wins when present")
  eq(merged["b/source.jpg"], "S-b", "missing thumb falls back to the source URL")
  ok(!("c/source.jpg" in merged), "neither signed → omitted so callers see null")
  eq(Object.keys(merged).length, 2, "result keyed by source path only")
}

// --- expiry quantization ----------------------------------------------------
const H = 3_600_000
const t0 = 1_700_000_000_000 - (1_700_000_000_000 % H) // an exact hour mark
{
  const a = signedUrlWindow(3600, t0 + 5 * 60_000) // :05 → boundary must be ≥ :35 → next hour
  const b = signedUrlWindow(3600, t0 + 25 * 60_000) // :25 → same boundary
  eq(a.boundaryMs, t0 + H, "default 1 h at :05 signs to the next hour mark")
  eq(a.boundaryMs, b.boundaryMs, "two calls in the same window share a boundary")
  eq(a.expiresInSeconds, 55 * 60, "expiresIn is the exact distance to the boundary")
  eq(b.expiresInSeconds, 35 * 60, "later call in the window asks for less time, same boundary")
  const c = signedUrlWindow(3600, t0 + 31 * 60_000) // :31 → :01 next hour is < 30 min → skip a boundary
  eq(c.boundaryMs, t0 + 2 * H, "a call straddling the 30-minute headroom moves to the following hour")
  ok(c.boundaryMs !== b.boundaryMs, "calls straddling a boundary differ")
  ok(c.expiresInSeconds >= 1800 && c.expiresInSeconds <= 5400, "1 h callers always get between 30 and 90 minutes")
  const six = signedUrlWindow(6 * 3600, t0 + 10 * 60_000)
  eq(six.boundaryMs, t0 + 6 * H, "explicit 6 h caller keeps its horizon, quantized to an hour mark")
  ok(six.expiresInSeconds >= 5.5 * 3600 && six.expiresInSeconds <= 6.5 * 3600, "6 h callers land within ±30 min of 6 h")
  const tiny = signedUrlWindow(60, t0 + 10 * 60_000)
  ok(tiny.expiresInSeconds >= 1800, "sub-30-minute requests are floored to the 30-minute headroom")
  eq(signedUrlWindow(3600, t0 + 5 * 60_000 + 250).expiresInSeconds, 55 * 60, "sub-second jitter rounds up to whole seconds")
}

// --- memo -------------------------------------------------------------------
{
  const cache = new SignedUrlCache(2)
  const boundary = t0 + H
  cache.set("originals", "a", boundary, "url-a", t0)
  eq(cache.get("originals", "a", boundary, t0), "url-a", "hit inside the window")
  eq(cache.get("originals", "a", boundary + H, t0), undefined, "different window misses")
  eq(cache.get("outputs", "a", boundary, t0), undefined, "bucket is part of the key")
  eq(cache.get("originals", "a", boundary, boundary), undefined, "entry at its boundary is expired")
  cache.set("originals", "b", boundary, "url-b", t0)
  cache.set("originals", "c", boundary, "url-c", t0)
  eq(cache.size, 2, "cap evicts the oldest-set entry")
  eq(cache.get("originals", "a", boundary, t0), undefined, "evicted entry misses")
  eq(cache.get("originals", "c", boundary, t0), "url-c", "newest entry survives")
}

// --- storage wrapper against a counted mock client ---------------------------
function mockClient(existing) {
  const calls = []
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths, expiresIn) {
            calls.push({ bucket, paths: [...paths], expiresIn })
            return {
              error: null,
              data: paths.map((path) =>
                existing.has(`${bucket}/${path}`)
                  ? { path, error: null, signedUrl: `https://x/${bucket}/${path}?token=${expiresIn}` }
                  : { path, error: "Either the object does not exist or you do not have access to it", signedUrl: null }
              ),
            }
          },
        }
      },
    },
  }
}
{
  const client = mockClient(new Set(["originals/p1/source.jpg", "originals/p1/thumb.jpg", "originals/p2/source.jpg"]))
  const first = await getThumbUrls("originals", ["p1/source.jpg", "p2/source.jpg"], client)
  eq(client.calls.length, 2, "one batch sign for thumbs, one only for the sources lacking a thumb")
  eq(client.calls[0].paths.join(), "p1/thumb.jpg,p2/thumb.jpg", "thumb paths signed in a single call")
  eq(client.calls[1].paths.join(), "p2/source.jpg", "only the missing thumb's source is signed")
  ok(first["p1/source.jpg"].includes("/p1/thumb.jpg"), "result keyed by source path, pointing at the thumb")
  ok(first["p2/source.jpg"].includes("/p2/source.jpg"), "missing thumb falls back to the full source")
  const second = await getThumbUrls("originals", ["p1/source.jpg", "p2/source.jpg"], client)
  eq(client.calls.length, 3, "second render re-probes only the still-missing thumb (misses are not negatively cached)")
  eq(client.calls[2].paths.join(), "p2/thumb.jpg", "the cached thumb and cached fallback source are not re-signed")
  eq(JSON.stringify(second), JSON.stringify(first), "byte-identical URLs across renders in one window")
  const single = await getUrl("originals", "p1/source.jpg", 3600, client)
  eq(client.calls.length, 4, "a never-signed source path signs once")
  eq(await getUrl("originals", "p1/source.jpg", 3600, client), single, "getUrl reuses the memo")
  eq(client.calls.length, 4, "no extra sign for the memoized getUrl")
  const empty = await getUrls("originals", [], 3600, client)
  eq(Object.keys(empty).length, 0, "empty input never calls storage")
  const missingOnly = await getUrls("originals", ["nope/source.jpg", "nope/source.jpg"], 3600, client)
  eq(client.calls.at(-1).paths.length, 1, "duplicate paths are de-duplicated before signing")
  ok(!("nope/source.jpg" in missingOnly), "missing objects are omitted, not thrown")
  await assert.rejects(getUrl("originals", "nope/source.jpg", 3600, client), /could not sign/)
  assertions += 1
  const six = await getUrl("outputs", "fg/step-0-r0.jpg", 6 * 3600, mockClient(new Set(["outputs/fg/step-0-r0.jpg"])))
  const requested = Number(new URL(six).searchParams.get("token"))
  ok(requested >= 5.5 * 3600 && requested <= 6.5 * 3600, "explicit 6 h callers pass a quantized ~6 h expiry")
}

// --- real thumb through sharp -----------------------------------------------
{
  const source = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg({ quality: 95 })
    .toBuffer()
  const thumb = await renderThumb(source)
  const meta = await sharp(thumb).metadata()
  eq(meta.width, THUMB_WIDTH, "thumb is resized to the target width")
  eq(meta.height, 320, "aspect ratio preserved")
  eq(meta.format, "jpeg", "thumb is a JPEG")
  ok(thumb.byteLength < 60_000, `thumb weighs under 60 KB (${thumb.byteLength} B)`)
  ok(!meta.exif, "metadata stripped")
  // EXIF orientation 6 (rotate 90° CW) is baked in, so a landscape source
  // with a portrait orientation tag comes out portrait.
  const tagged = await sharp(source).withMetadata({ orientation: 6 }).toBuffer()
  const rotated = await sharp(await renderThumb(tagged)).metadata()
  ok(rotated.height > rotated.width, "EXIF orientation is applied, not carried as a tag")
  const small = await sharp({ create: { width: 200, height: 150, channels: 3, background: "#333" } }).png().toBuffer()
  eq((await sharp(await renderThumb(small)).metadata()).width, 200, "small sources are never enlarged")
}

console.log(`test-thumbnails: ${assertions} assertions passed`)
