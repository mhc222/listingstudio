// All storage access goes through this wrapper (future R2 swap point).
import { createClient } from "@/lib/supabase/server"

export type Bucket = "originals" | "outputs" | "references"

export async function upload(
  bucket: Bucket,
  path: string,
  body: ArrayBuffer | Blob | Buffer,
  contentType?: string
) {
  const supabase = await createClient()
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, { contentType, upsert: bucket !== "originals" })
  if (error) throw error
  return path
}

export async function getUrl(bucket: Bucket, path: string, expiresInSeconds = 3600) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}

export async function getUrls(bucket: Bucket, paths: string[], expiresInSeconds = 3600) {
  if (paths.length === 0) return {}
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, expiresInSeconds)
  if (error) throw error
  return Object.fromEntries(data.map((d) => [d.path, d.signedUrl]))
}

export async function download(bucket: Bucket, path: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw error
  return data
}
