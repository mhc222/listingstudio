import { NextResponse } from "next/server"
import {
  MAX_UPLOAD_FILES,
  type UploadDeclaration,
  validateUploadDeclaration,
} from "@/config/uploads"
import { intakePath, sourcePath } from "@/lib/intake"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type PrepareBody = {
  listingId?: unknown
  files?: unknown
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as PrepareBody | null
  if (!body || typeof body.listingId !== "string" || !Array.isArray(body.files)) {
    return NextResponse.json({ error: "listingId and files are required" }, { status: 400 })
  }
  if (body.files.length === 0 || body.files.length > MAX_UPLOAD_FILES) {
    return NextResponse.json(
      { error: `select between 1 and ${MAX_UPLOAD_FILES} files` },
      { status: 400 }
    )
  }

  let declarations
  try {
    declarations = body.files.map((file) =>
      validateUploadDeclaration(file as UploadDeclaration)
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid file declaration" },
      { status: 400 }
    )
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("id")
    .eq("id", body.listingId)
    .maybeSingle()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  const requestedRoomIds = [...new Set(declarations.map((file) => file.roomId).filter(Boolean))]
  if (requestedRoomIds.length > 0) {
    const { data: rooms, error } = await supabase
      .from("rooms")
      .select("id")
      .eq("listing_id", body.listingId)
      .in("id", requestedRoomIds)
    if (error || rooms?.length !== requestedRoomIds.length) {
      return NextResponse.json(
        { error: "one or more rooms do not belong to this listing" },
        { status: 400 }
      )
    }
  }

  const batchId = crypto.randomUUID()
  const reservations = declarations.map((file) => {
    const itemId = crypto.randomUUID()
    const photoId = crypto.randomUUID()
    return {
      id: itemId,
      batch_id: batchId,
      photo_id: photoId,
      room_id: file.roomId,
      original_filename: file.originalFilename,
      declared_content_type: file.contentType,
      declared_byte_size: file.byteSize,
      source_extension: file.extension,
      is_floor_plan: file.isFloorPlan,
      intake_path: intakePath(
        user.id,
        body.listingId as string,
        batchId,
        itemId,
        file.extension
      ),
      source_storage_path: sourcePath(
        user.id,
        body.listingId as string,
        photoId,
        file.extension
      ),
    }
  })

  const admin = createAdminClient()
  const { error: batchError } = await admin.from("upload_batches").insert({
    id: batchId,
    listing_id: body.listingId,
  })
  if (batchError) {
    return NextResponse.json({ error: "could not reserve upload batch" }, { status: 500 })
  }

  const { error: itemError } = await admin.from("upload_items").insert(reservations)
  if (itemError) {
    await admin.from("upload_batches").delete().eq("id", batchId)
    return NextResponse.json({ error: "could not reserve upload items" }, { status: 500 })
  }

  try {
    const items = await Promise.all(
      reservations.map(async (item) => {
        const { data, error } = await supabase.storage
          .from("intake")
          .createSignedUploadUrl(item.intake_path)
        if (error) throw error
        return {
          id: item.id,
          photoId: item.photo_id,
          name: item.original_filename,
          size: item.declared_byte_size,
          contentType: item.declared_content_type,
          intakePath: item.intake_path,
          signedUrl: data.signedUrl,
          token: data.token,
        }
      })
    )
    return NextResponse.json({ batchId, expiresInSeconds: 7200, items })
  } catch {
    await admin.from("upload_batches").delete().eq("id", batchId)
    return NextResponse.json({ error: "could not authorize direct upload" }, { status: 500 })
  }
}
