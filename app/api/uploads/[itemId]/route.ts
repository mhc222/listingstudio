import { NextResponse } from "next/server"
import { getOwnedUploadItem } from "@/lib/intake-lifecycle"
import { createClient } from "@/lib/supabase/server"

export async function GET(
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

  return NextResponse.json({
    item: {
      id: item.id,
      batchId: item.batch_id,
      photoId: item.photo_id,
      name: item.original_filename,
      size: item.declared_byte_size,
      contentType: item.declared_content_type,
      status: item.status,
      error: item.error,
      finalizedAt: item.finalized_at,
      cleanupPending: item.status === "complete" && !item.intake_deleted_at,
    },
  })
}
