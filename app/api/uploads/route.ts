import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { UPLOAD_POLL_MAX_IDS } from "@/lib/upload-queue"

const UPLOAD_ITEM_COLUMNS =
  "id, batch_id, photo_id, original_filename, declared_byte_size, declared_content_type, is_floor_plan, intake_path, status, error, finalized_at, created_at, updated_at"

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const listingId = new URL(req.url).searchParams.get("listingId")
  if (!listingId) {
    return NextResponse.json({ error: "listingId is required" }, { status: 400 })
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("id")
    .eq("id", listingId)
    .maybeSingle()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  // Phase 57: the queue polls specific items while they finalize in the
  // background; their batch may already have closed, so look them up by id
  // (RLS still scopes the read to the owner's rows).
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, UPLOAD_POLL_MAX_IDS)
  if (ids.length > 0) {
    const { data: items, error } = await supabase
      .from("upload_items")
      .select(UPLOAD_ITEM_COLUMNS)
      .in("id", ids)
      .order("created_at", { ascending: true })
    if (error) {
      return NextResponse.json({ error: "could not load upload status" }, { status: 500 })
    }
    return NextResponse.json({ batches: [], items })
  }

  const { data: batches, error: batchError } = await supabase
    .from("upload_batches")
    .select("id, status, created_at, updated_at")
    .eq("listing_id", listingId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50)
  if (batchError) {
    return NextResponse.json({ error: "could not load upload recovery state" }, { status: 500 })
  }

  const batchIds = (batches ?? []).map((batch) => batch.id)
  if (batchIds.length === 0) return NextResponse.json({ batches: [], items: [] })

  const { data: items, error: itemError } = await supabase
    .from("upload_items")
    .select(UPLOAD_ITEM_COLUMNS)
    .in("batch_id", batchIds)
    .order("created_at", { ascending: true })
  if (itemError) {
    return NextResponse.json({ error: "could not load upload recovery state" }, { status: 500 })
  }

  return NextResponse.json({ batches, items })
}
