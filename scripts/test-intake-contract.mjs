import { createHash, randomBytes, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import sharp from "sharp"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

function checkStaticContract() {
  const migration = read("supabase/migrations/0009_reliable_intake.sql")
  const prepare = read("app/api/uploads/prepare/route.ts")
  const finalize = read("app/api/uploads/[itemId]/finalize/route.ts")
  const cancel = read("app/api/uploads/[itemId]/cancel/route.ts")
  const intake = read("lib/intake.ts")

  const required = [
    [migration, "'intake',\n  'intake',\n  false", "private intake bucket"],
    [migration, "52428800", "50 MB database/storage limit"],
    [migration, "(storage.foldername(name))[1] = auth.uid()::text", "path-scoped RLS"],
    [migration, "photo_id uuid not null unique", "one upload item per photo"],
    [migration, "upload_item_id uuid unique", "one photo per upload item"],
    [migration, "create or replace function finalize_upload_item", "atomic finalizer"],
    [migration, "to service_role", "server-only finalizer permission"],
    [migration, "photos_default_source_path", "legacy upload compatibility"],
    [prepare, "createSignedUploadUrl", "direct upload authorization"],
    [prepare, "MAX_UPLOAD_FILES", "central selection limit"],
    [finalize, "materializeIntakeItem", "server-side verification/finalization"],
    [finalize, "idempotent: true", "lost-response retry"],
    [cancel, 'in("status", ["reserved", "failed"])', "conditional cancellation"],
    [intake, "sniffContentType", "magic-byte type validation"],
    [intake, "sourceStoragePath", "raw source lineage"],
    [intake, "canonicalStoragePath", "canonical derivative lineage"],
  ]

  for (const [source, needle, label] of required) {
    assert(source.includes(needle), `missing static contract: ${label}`)
  }
  console.log(`static contract: ${required.length} assertions passed`)
}

function args() {
  const values = process.argv.slice(2)
  return {
    live: values.includes("--live"),
    heic: values.includes("--heic") ? values[values.indexOf("--heic") + 1] : null,
    baseUrl: values.includes("--base-url")
      ? values[values.indexOf("--base-url") + 1]
      : "http://localhost:3000",
  }
}

function envFile() {
  return Object.fromEntries(
    read(".env.local")
      .split("\n")
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=")
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, "")]
      })
  )
}

function sessionFromCookie(cookieLine) {
  const encoded = cookieLine.slice(cookieLine.indexOf("=") + 1).trim()
  assert(encoded.startsWith("base64-"), "unexpected session cookie format")
  return JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString("utf8"))
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${response.status}: ${body.error ?? "request failed"}`)
  return body
}

async function liveContract({ baseUrl, heic }) {
  const env = envFile()
  const cookie = read(".session-cookie.txt").trim()
  const session = sessionFromCookie(cookie)
  const user = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  })
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth, error: authError } = await user.auth.getUser(session.access_token)
  if (authError || !auth.user) throw authError ?? new Error("session user unavailable")
  const { data: listing, error: listingError } = await user
    .from("listings")
    .select("id")
    .limit(1)
    .maybeSingle()
  if (listingError || !listing) throw listingError ?? new Error("no owned listing available")

  const batchIds = new Set()
  const photoIds = new Set()
  const originalPaths = new Set()
  const intakePaths = new Set()
  const otherPath = `${randomUUID()}/rls-test/${randomUUID()}.jpg`

  const api = async (path, init = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init.headers },
    })

  const prepare = async (declaration) => {
    const result = await responseJson(
      await api("/api/uploads/prepare", {
        method: "POST",
        body: JSON.stringify({ listingId: listing.id, files: [declaration] }),
      })
    )
    batchIds.add(result.batchId)
    intakePaths.add(result.items[0].intakePath)
    photoIds.add(result.items[0].photoId)
    return result.items[0]
  }

  const transfer = async (item, bytes, contentType) => {
    const { error } = await user.storage
      .from("intake")
      .uploadToSignedUrl(item.intakePath, item.token, bytes, { contentType, upsert: false })
    if (error) throw error
  }

  const transferTusWithResume = async (item, bytes, contentType) => {
    const projectUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
    const endpoint = projectUrl.hostname.endsWith(".supabase.co")
      ? `${projectUrl.protocol}//${projectUrl.hostname.replace(".supabase.co", ".storage.supabase.co")}/storage/v1/upload/resumable`
      : `${projectUrl.origin}/storage/v1/upload/resumable`
    const encode = (value) => Buffer.from(value).toString("base64")
    const commonHeaders = {
      authorization: `Bearer ${session.access_token}`,
      "x-signature": item.token,
      "x-upsert": "false",
      "tus-resumable": "1.0.0",
    }
    const created = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...commonHeaders,
        "upload-length": String(bytes.byteLength),
        "upload-metadata": [
          `bucketName ${encode("intake")}`,
          `objectName ${encode(item.intakePath)}`,
          `contentType ${encode(contentType)}`,
          `cacheControl ${encode("3600")}`,
        ].join(","),
      },
    })
    assert(created.status === 201, `TUS create failed: ${created.status} ${await created.text()}`)
    const location = created.headers.get("location")
    assert(location, "TUS create did not return an upload URL")
    const uploadUrl = new URL(location, endpoint).toString()
    const chunkSize = 6 * 1024 * 1024
    let offset = 0

    const patchChunk = async () => {
      const end = Math.min(offset + chunkSize, bytes.byteLength)
      const response = await fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          ...commonHeaders,
          "content-type": "application/offset+octet-stream",
          "upload-offset": String(offset),
        },
        body: bytes.subarray(offset, end),
      })
      assert(response.status === 204, `TUS patch failed: ${response.status} ${await response.text()}`)
      offset = Number(response.headers.get("upload-offset"))
      assert(offset === end, "TUS server returned an unexpected upload offset")
    }

    await patchChunk()
    const resumed = await fetch(uploadUrl, { method: "HEAD", headers: commonHeaders })
    assert(resumed.ok, `TUS resume probe failed: ${resumed.status}`)
    offset = Number(resumed.headers.get("upload-offset"))
    assert(offset === chunkSize, "TUS resume probe did not preserve the first 6 MiB chunk")
    while (offset < bytes.byteLength) await patchChunk()
  }

  const finalize = async (item, expectedStatus = 200) => {
    const response = await api(`/api/uploads/${item.id}/finalize`, { method: "POST", body: "{}" })
    const body = await response.json().catch(() => ({}))
    assert(response.status === expectedStatus, `finalize ${item.id}: ${response.status} ${body.error ?? ""}`)
    return body
  }

  const cancel = async (item) =>
    responseJson(await api(`/api/uploads/${item.id}/cancel`, { method: "POST", body: "{}" }))

  try {
    const noise = randomBytes(4200 * 3600 * 3)
    const jpeg = await sharp(noise, { raw: { width: 4200, height: 3600, channels: 3 } })
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
      .toBuffer()
    assert(jpeg.byteLength > 10 * 1024 * 1024, "generated JPEG is not larger than 10 MB")
    assert(jpeg.byteLength <= 50 * 1024 * 1024, "generated JPEG exceeds 50 MB")

    const large = await prepare({ name: "phase-43-over-10mb.jpg", size: jpeg.byteLength, type: "image/jpeg" })
    await transferTusWithResume(large, jpeg, "image/jpeg")

    const { count: beforeCount } = await admin
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("id", large.photoId)
    assert(beforeCount === 0, "object-written/row-missing boundary was not established")

    await finalize(large)
    const { data: photo, count } = await admin
      .from("photos")
      .select("id, storage_path, source_storage_path", { count: "exact" })
      .eq("id", large.photoId)
      .single()
    assert(count === 1 && photo, "first finalize did not create exactly one photo")
    originalPaths.add(photo.source_storage_path)
    originalPaths.add(photo.storage_path)

    const { data: storedSource, error: sourceError } = await user.storage
      .from("originals")
      .download(photo.source_storage_path)
    if (sourceError) throw sourceError
    assert(
      sha256(Buffer.from(await storedSource.arrayBuffer())) === sha256(jpeg),
      "immutable source bytes changed"
    )

    const second = await finalize(large)
    assert(second.idempotent === true, "double-finalize was not reported as idempotent")
    const { count: doubleCount } = await admin
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("upload_item_id", large.id)
    assert(doubleCount === 1, "double-finalize created more than one photo")

    const directFinalize = await user.rpc("finalize_upload_item", {
      p_item_id: large.id,
      p_user_id: auth.user.id,
      p_source_storage_path: photo.source_storage_path,
      p_canonical_storage_path: photo.storage_path,
      p_source_content_type: "image/jpeg",
      p_canonical_content_type: "image/jpeg",
      p_source_byte_size: jpeg.byteLength,
      p_width: 4200,
      p_height: 3600,
    })
    assert(directFinalize.error, "authenticated clients can invoke the privileged finalizer")

    await admin.from("upload_items").update({ status: "finalizing" }).eq("id", large.id)
    const recovered = await finalize(large)
    assert(recovered.status === "complete", "row-created/status-not-finished retry did not converge")

    await admin.storage.from("intake").upload(large.intakePath, jpeg, { contentType: "image/jpeg" })
    await admin.from("upload_items").update({ intake_deleted_at: null }).eq("id", large.id)
    const cleanupRetry = await finalize(large)
    assert(cleanupRetry.cleanupPending === false, "cleanup retry did not remove staged object")

    const orientedJpeg = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#c9a45c" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 95 })
      .toBuffer()
    const oriented = await prepare({
      name: "exif-orientation-6.jpg",
      size: orientedJpeg.byteLength,
      type: "image/jpeg",
    })
    await transfer(oriented, orientedJpeg, "image/jpeg")
    await finalize(oriented)
    const { data: orientedPhoto } = await admin
      .from("photos")
      .select("storage_path, source_storage_path")
      .eq("id", oriented.photoId)
      .single()
    assert(
      orientedPhoto.storage_path !== orientedPhoto.source_storage_path,
      "EXIF-oriented JPEG did not create a canonical derivative"
    )
    const { data: orientedSource } = await admin.storage
      .from("originals")
      .download(orientedPhoto.source_storage_path)
    const { data: orientedCanonical } = await admin.storage
      .from("originals")
      .download(orientedPhoto.storage_path)
    assert(
      sha256(Buffer.from(await orientedSource.arrayBuffer())) === sha256(orientedJpeg),
      "EXIF source bytes changed"
    )
    const orientedMetadata = await sharp(Buffer.from(await orientedCanonical.arrayBuffer())).metadata()
    assert(
      orientedMetadata.width === 20 && orientedMetadata.height === 40,
      "EXIF canonical derivative was not physically rotated"
    )
    originalPaths.add(orientedPhoto.storage_path)
    originalPaths.add(orientedPhoto.source_storage_path)

    await user.storage
      .from("originals")
      .update(photo.source_storage_path, Buffer.from("overwrite"), { contentType: "image/jpeg" })
    await user.storage.from("originals").remove([photo.source_storage_path])
    const { data: sourceAfterMutationAttempts, error: sourceMutationError } = await admin.storage
      .from("originals")
      .download(photo.source_storage_path)
    if (sourceMutationError) throw sourceMutationError
    assert(
      sha256(Buffer.from(await sourceAfterMutationAttempts.arrayBuffer())) === sha256(jpeg),
      "authenticated overwrite/delete changed an immutable original"
    )

    const spoof = Buffer.alloc(64, 1)
    const spoofed = await prepare({ name: "spoofed.jpg", size: spoof.byteLength, type: "image/jpeg" })
    await transfer(spoofed, spoof, "image/jpeg")
    await finalize(spoofed, 422)
    await cancel(spoofed)

    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
      .jpeg()
      .toBuffer()
    const wrongSize = await prepare({ name: "wrong-size.jpg", size: tiny.byteLength + 1, type: "image/jpeg" })
    await transfer(wrongSize, tiny, "image/jpeg")
    await finalize(wrongSize, 422)
    await cancel(wrongSize)

    const canceled = await prepare({ name: "cancel-me.jpg", size: tiny.byteLength, type: "image/jpeg" })
    await transfer(canceled, tiny, "image/jpeg")
    await cancel(canceled)
    const { count: canceledPhotos } = await admin
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("id", canceled.photoId)
    assert(canceledPhotos === 0, "canceled upload created a photo")

    await admin.storage.from("intake").upload(otherPath, tiny, { contentType: "image/jpeg" })
    const crossRead = await user.storage.from("intake").download(otherPath)
    assert(crossRead.error, "authenticated user could read another prefix")
    const crossWrite = await user.storage
      .from("intake")
      .upload(`${randomUUID()}/rls-test/${randomUUID()}.jpg`, tiny, { contentType: "image/jpeg" })
    assert(crossWrite.error, "authenticated user could write another prefix")

    if (heic) {
      const heicBytes = readFileSync(heic)
      const heicItem = await prepare({ name: "phase-43.heic", size: heicBytes.byteLength, type: "image/heic" })
      await transfer(heicItem, heicBytes, "image/heic")
      await finalize(heicItem)
      const { data: heicPhoto } = await admin
        .from("photos")
        .select("storage_path, source_storage_path")
        .eq("id", heicItem.photoId)
        .single()
      assert(heicPhoto.storage_path !== heicPhoto.source_storage_path, "HEIC did not create a canonical derivative")
      assert(heicPhoto.storage_path.endsWith("canonical.jpg"), "HEIC canonical path is not JPEG")
      const { data: heicSource } = await admin.storage
        .from("originals")
        .download(heicPhoto.source_storage_path)
      assert(
        sha256(Buffer.from(await heicSource.arrayBuffer())) === sha256(heicBytes),
        "HEIC source bytes changed"
      )
      originalPaths.add(heicPhoto.storage_path)
      originalPaths.add(heicPhoto.source_storage_path)
    }

    console.log(`live contract: resumable >10 MB (${(jpeg.byteLength / 1024 / 1024).toFixed(1)} MB), idempotency, recovery, cancellation, spoofing, cleanup, and RLS passed`)
    if (!heic) console.log("HEIC: skipped (pass --heic /absolute/path/to/sample.heic for the manual gate)")
  } finally {
    if (photoIds.size) {
      const { data: testPhotos } = await admin
        .from("photos")
        .select("storage_path, source_storage_path")
        .in("id", [...photoIds])
      for (const photo of testPhotos ?? []) {
        originalPaths.add(photo.storage_path)
        originalPaths.add(photo.source_storage_path)
      }
      const { data: testItems } = await admin
        .from("upload_items")
        .select("source_storage_path, canonical_storage_path")
        .in("photo_id", [...photoIds])
      for (const item of testItems ?? []) {
        originalPaths.add(item.source_storage_path)
        if (item.canonical_storage_path) originalPaths.add(item.canonical_storage_path)
        const directory = item.source_storage_path.split("/").slice(0, -1).join("/")
        originalPaths.add(`${directory}/canonical.jpg`)
        originalPaths.add(`${directory}/canonical.png`)
        originalPaths.add(`${directory}/canonical.webp`)
      }
      await admin.from("photos").delete().in("id", [...photoIds])
    }
    if (batchIds.size) await admin.from("upload_batches").delete().in("id", [...batchIds])
    await admin.storage.from("intake").remove([...intakePaths, otherPath])
    const knownPaths = [...originalPaths].filter((path) => typeof path === "string" && path.includes("/"))
    if (knownPaths.length) await admin.storage.from("originals").remove(knownPaths)
  }
}

checkStaticContract()
const options = args()
if (options.live) await liveContract(options)
