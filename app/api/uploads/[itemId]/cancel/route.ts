import { NextResponse } from "next/server"
import {
  cleanupIntakeObject,
  cleanupUncommittedOriginals,
  getOwnedUploadItem,
  refreshUploadBatchStatus,
} from "@/lib/intake-lifecycle"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

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
  if (item.status === "complete") {
    return NextResponse.json({ error: "completed uploads cannot be canceled" }, { status: 409 })
  }
  if (item.status === "finalizing") {
    return NextResponse.json({ error: "upload item is already finalizing" }, { status: 409 })
  }

  const admin = createAdminClient()
  if (item.status !== "canceled") {
    const { data: canceled } = await admin
      .from("upload_items")
      .update({ status: "canceled", error: null, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .in("status", ["reserved", "failed"])
      .select("id")
      .maybeSingle()
    if (!canceled) {
      return NextResponse.json({ error: "upload item state changed; retry" }, { status: 409 })
    }
  }

  await cleanupIntakeObject(item, admin)
  await cleanupUncommittedOriginals(item, admin)
  await refreshUploadBatchStatus(item.batch_id, admin)
  return NextResponse.json({ itemId: item.id, status: "canceled" })
}
