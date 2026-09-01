import { NextResponse } from "next/server"
import { materializeIntakeItem } from "@/lib/intake"
import {
  cleanupIntakeObject,
  getOwnedUploadItem,
  refreshUploadBatchStatus,
} from "@/lib/intake-lifecycle"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 120

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const item = await getOwnedUploadItem(supabase, itemId)
  if (!item) return NextResponse.json({ error: "upload item not found" }, { status: 404 })
  if (item.status === "canceled") {
    return NextResponse.json({ error: "upload item was canceled" }, { status: 409 })
  }

  const admin = createAdminClient()
  if (item.status === "complete") {
    const cleaned = await cleanupIntakeObject(item, admin)
    return NextResponse.json({
      itemId: item.id,
      photoId: item.photo_id,
      status: "complete",
      cleanupPending: !cleaned,
      idempotent: true,
    })
  }

  const now = new Date().toISOString()
  const { data: claimed, error: claimError } = await admin
    .from("upload_items")
    .update({ status: "finalizing", error: null, updated_at: now })
    .eq("id", item.id)
    .in("status", ["reserved", "failed"])
    .select("status")
    .maybeSingle()
  if (claimError) {
    return NextResponse.json({ error: "could not begin finalization" }, { status: 500 })
  }
  if (!claimed && item.status !== "finalizing") {
    const { data: latest } = await admin
      .from("upload_items")
      .select("status")
      .eq("id", item.id)
      .maybeSingle()
    if (latest?.status === "canceled") {
      return NextResponse.json({ error: "upload item was canceled" }, { status: 409 })
    }
    if (latest?.status === "complete") {
      const cleaned = await cleanupIntakeObject(item, admin)
      return NextResponse.json({
        itemId: item.id,
        photoId: item.photo_id,
        status: "complete",
        cleanupPending: !cleaned,
        idempotent: true,
      })
    }
    if (latest?.status !== "finalizing") {
      return NextResponse.json({ error: "upload item state changed; retry" }, { status: 409 })
    }
  }

  try {
    const materialized = await materializeIntakeItem(item, admin)
    const { data: photoId, error } = await admin.rpc("finalize_upload_item", {
      p_item_id: item.id,
      p_user_id: user.id,
      p_source_storage_path: materialized.sourceStoragePath,
      p_canonical_storage_path: materialized.canonicalStoragePath,
      p_source_content_type: materialized.sourceContentType,
      p_canonical_content_type: materialized.canonicalContentType,
      p_source_byte_size: materialized.sourceByteSize,
      p_width: materialized.width,
      p_height: materialized.height,
    })
    if (error) throw error

    const latest = (await getOwnedUploadItem(supabase, item.id)) ?? item
    const cleaned = await cleanupIntakeObject(latest, admin)
    await refreshUploadBatchStatus(item.batch_id, admin)
    return NextResponse.json({
      itemId: item.id,
      photoId,
      status: "complete",
      cleanupPending: !cleaned,
      idempotent: false,
    })
  } catch (error) {
    const { data: latest } = await admin
      .from("upload_items")
      .select("status, photo_id, intake_deleted_at, intake_path")
      .eq("id", item.id)
      .maybeSingle()

    if (latest?.status === "complete") {
      const cleaned = await cleanupIntakeObject(
        { id: item.id, intake_path: latest.intake_path, intake_deleted_at: latest.intake_deleted_at },
        admin
      )
      return NextResponse.json({
        itemId: item.id,
        photoId: latest.photo_id,
        status: "complete",
        cleanupPending: !cleaned,
        idempotent: true,
      })
    }

    const message = error instanceof Error ? error.message : "finalization failed"
    await admin
      .from("upload_items")
      .update({ status: "failed", error: message.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("status", "finalizing")
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
