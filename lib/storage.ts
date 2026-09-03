// All storage access goes through this wrapper (future R2 swap point).
// Pass an explicit client (e.g. admin) from webhook/cron contexts; defaults to
// the cookie-session server client.
import type { SupabaseClient } from "@supabase/supabase-js"
import { SignedUrlCache, signedUrlWindow } from "./signed-urls.ts"
import { mergeThumbUrls, renderThumb, thumbPathFor } from "./thumbs.ts"

export type Bucket = "originals" | "outputs" | "references" | "intake"

// The cookie-session client is imported lazily so this module (and the thumb
// backfill / unit tests that always pass an explicit client) loads outside a
// Next request scope, where `next/headers` is unavailable.
async function resolveClient(client?: SupabaseClient) {
  if (client) return client
  const { createClient } = await import("./supabase/server.ts")
  return createClient()
}

// Process-local memo of minted signed URLs, keyed by object and hourly window
// (see lib/signed-urls.ts). The memo is not keyed by caller: storage RLS
// (migration 0009) scopes reads to the owner's folder, and every object path
// starts with the owner's user id, so a cached URL is only ever handed back to
// a caller asking for that owner's path. Table RLS keeps other users from
// learning those paths in the first place.
const signedUrlCache = new SignedUrlCache()

export async function upload(
  bucket: Bucket,
  path: string,
  body: ArrayBuffer | Blob | Buffer,
  contentType?: string,
  client?: SupabaseClient
) {
  const supabase = await resolveClient(client)
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, {
      contentType,
      upsert: bucket === "outputs" || bucket === "references",
    })
  if (error) throw error
  return path
}

export async function getUrl(
  bucket: Bucket,
  path: string,
  expiresInSeconds = 3600,
  client?: SupabaseClient
) {
  const urls = await getUrls(bucket, [path], expiresInSeconds, client)
  const url = urls[path]
  if (!url) throw new Error(`could not sign ${bucket}/${path}`)
  return url
}

// Signs the paths that are not already memoized for the current hourly window
// in one createSignedUrls call. Paths whose object is missing are omitted from
// the result (the batch call reports them per item; nothing is thrown), so
// callers read `urls[path] ?? null` as before.
export async function getUrls(
  bucket: Bucket,
  paths: string[],
  expiresInSeconds = 3600,
  client?: SupabaseClient
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return {}
  const now = Date.now()
  const { boundaryMs, expiresInSeconds: quantized } = signedUrlWindow(expiresInSeconds, now)
  const out: Record<string, string> = {}
  const misses: string[] = []
  for (const path of unique) {
    const cached = signedUrlCache.get(bucket, path, boundaryMs, now)
    if (cached) out[path] = cached
    else misses.push(path)
  }
  if (misses.length === 0) return out
  const supabase = await resolveClient(client)
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(misses, quantized)
  if (error) throw error
  for (const item of data) {
    if (!item.path || !item.signedUrl || item.error) continue
    out[item.path] = item.signedUrl
    signedUrlCache.set(bucket, item.path, boundaryMs, item.signedUrl, now)
  }
  return out
}

// Grid/rail URLs: the thumb when it exists, else the full-size source. The
// batch sign reports a per-path error for a missing thumb, so the only extra
// call is a second batch sign for the sources that actually lack one (none
// after the backfill). Result is keyed by the SOURCE path.
export async function getThumbUrls(
  bucket: Bucket,
  paths: string[],
  client?: SupabaseClient
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return {}
  const thumbs = await getUrls(bucket, unique.map(thumbPathFor), 3600, client)
  const missing = unique.filter((path) => !thumbs[thumbPathFor(path)])
  const sources = missing.length ? await getUrls(bucket, missing, 3600, client) : {}
  return mergeThumbUrls(unique, thumbs, sources)
}

// Derive and store the thumb beside `sourcePath`. Idempotent: `originals`
// forbids overwrite, so an "already exists" upload error is a success when the
// object is present. Never touches the source object or SpendLedger.
export async function storeThumb(
  bucket: Bucket,
  sourcePath: string,
  sourceBuffer: Buffer,
  client?: SupabaseClient
) {
  const path = thumbPathFor(sourcePath)
  const body = await renderThumb(sourceBuffer)
  try {
    await upload(bucket, path, body, "image/jpeg", client)
  } catch (uploadError) {
    try {
      await info(bucket, path, client)
    } catch {
      throw uploadError
    }
  }
  return path
}

export async function list(bucket: Bucket, prefix: string, client?: SupabaseClient) {
  const supabase = await resolveClient(client)
  const { data, error } = await supabase.storage.from(bucket).list(prefix)
  if (error) throw error
  return data.map((o) => o.name)
}

export async function download(bucket: Bucket, path: string, client?: SupabaseClient) {
  const supabase = await resolveClient(client)
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw error
  return data
}

export async function info(bucket: Bucket, path: string, client?: SupabaseClient) {
  const supabase = await resolveClient(client)
  const { data, error } = await supabase.storage.from(bucket).info(path)
  if (error) throw error
  return data
}

export async function copy(
  sourceBucket: Bucket,
  sourcePath: string,
  destinationBucket: Bucket,
  destinationPath: string,
  client?: SupabaseClient
) {
  const supabase = await resolveClient(client)
  const { error } = await supabase.storage
    .from(sourceBucket)
    .copy(sourcePath, destinationPath, { destinationBucket })
  if (error) throw error
  return destinationPath
}

export async function remove(bucket: Bucket, paths: string[], client?: SupabaseClient) {
  if (paths.length === 0) return
  const supabase = await resolveClient(client)
  const { error } = await supabase.storage.from(bucket).remove(paths)
  if (error) throw error
}
