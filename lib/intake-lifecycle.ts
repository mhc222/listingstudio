import type { SupabaseClient } from "@supabase/supabase-js"
import type { IntakeItem } from "@/lib/intake"
import { remove } from "@/lib/storage"

export type OwnedUploadItem = IntakeItem & {
  batch_id: string
  room_id: string | null
  error: string | null
  finalized_at: string | null
  intake_deleted_at: string | null
}

export async function getOwnedUploadItem(
  client: SupabaseClient,
  itemId: string
): Promise<OwnedUploadItem | null> {
  const { data: item } = await client
    .from("upload_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle()
  if (!item) return null

  const { data: batch } = await client
    .from("upload_batches")
    .select("listing_id")
    .eq("id", item.batch_id)
    .maybeSingle()
  if (!batch) return null

  return { ...item, listing_id: batch.listing_id } as OwnedUploadItem
}

export async function cleanupIntakeObject(
  item: Pick<OwnedUploadItem, "id" | "intake_path" | "intake_deleted_at">,
  admin: SupabaseClient
) {
  if (item.intake_deleted_at) return true
  try {
    await remove("intake", [item.intake_path], admin)
    const { error } = await admin
      .from("upload_items")
      .update({ intake_deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", item.id)
    if (error) throw error
    return true
  } catch {
    return false
  }
}

export async function cleanupUncommittedOriginals(
  item: Pick<OwnedUploadItem, "photo_id" | "source_storage_path">,
  admin: SupabaseClient
) {
  const { data: photo, error } = await admin
    .from("photos")
    .select("id")
    .eq("id", item.photo_id)
    .maybeSingle()
  if (error) throw error
  if (photo) return false

  const directory = item.source_storage_path.split("/").slice(0, -1).join("/")
  await remove(
    "originals",
    [
      item.source_storage_path,
      `${directory}/canonical.jpg`,
      `${directory}/canonical.png`,
      `${directory}/canonical.webp`,
    ],
    admin
  )
  return true
}

export async function refreshUploadBatchStatus(batchId: string, admin: SupabaseClient) {
  const { data: items, error } = await admin
    .from("upload_items")
    .select("status")
    .eq("batch_id", batchId)
  if (error || !items?.length) return
  if (items.some((item) => !["complete", "canceled"].includes(item.status))) return

  const status = items.some((item) => item.status === "complete") ? "complete" : "canceled"
  await admin
    .from("upload_batches")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", batchId)
}
