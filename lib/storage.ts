// All storage access goes through this wrapper (future R2 swap point).
// Pass an explicit client (e.g. admin) from webhook/cron contexts; defaults to
// the cookie-session server client.
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

export type Bucket = "originals" | "outputs" | "references" | "intake"

async function resolveClient(client?: SupabaseClient) {
  return client ?? (await createClient())
}

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
  const supabase = await resolveClient(client)
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}

export async function getUrls(
  bucket: Bucket,
  paths: string[],
  expiresInSeconds = 3600,
  client?: SupabaseClient
) {
  if (paths.length === 0) return {}
  const supabase = await resolveClient(client)
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, expiresInSeconds)
  if (error) throw error
  return Object.fromEntries(data.map((d) => [d.path, d.signedUrl]))
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
