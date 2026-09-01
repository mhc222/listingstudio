import { NextResponse } from "next/server"
import sharp from "sharp"
import { fuseExposures } from "@/lib/hdr"
import { download, info, upload } from "@/lib/storage"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 120

// Phase 45: HDR never asks the browser to upload source bytes twice. The
// durable owned group identifies its ordered immutable source exposures.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { listingId?: unknown; groupId?: unknown } | null
  if (!body || typeof body.listingId !== "string" || typeof body.groupId !== "string") {
    return NextResponse.json({ error: "listingId and groupId are required" }, { status: 400 })
  }
  const { data: group } = await supabase
    .from("photo_groups")
    .select("id, listing_id, state, representative_photo_id, merge_photo_id")
    .eq("id", body.groupId).eq("listing_id", body.listingId).maybeSingle()
  if (!group) return NextResponse.json({ error: "HDR stack not found" }, { status: 404 })
  if (group.state === "dismissed") {
    return NextResponse.json({ error: "This HDR stack was marked as separate photos." }, { status: 409 })
  }
  if (group.state === "confirmed" && group.representative_photo_id) {
    return NextResponse.json({ photoId: group.representative_photo_id, groupId: group.id, status: "confirmed", idempotent: true })
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("photo_group_members").select("photo_id, position").eq("group_id", group.id).order("position")
  if (membershipError || !memberships || memberships.length < 3 || memberships.length > 9) {
    return NextResponse.json({ error: "HDR stack needs 3–9 source exposures." }, { status: 400 })
  }
  const ids = memberships.map((member) => member.photo_id)
  const { data: photos } = await supabase
    .from("photos").select("id, listing_id, storage_path, is_floor_plan, photo_role")
    .in("id", ids).eq("listing_id", body.listingId)
  if (!photos || photos.length !== ids.length || photos.some((photo) => photo.is_floor_plan || photo.photo_role !== "source")) {
    return NextResponse.json({ error: "One or more HDR source exposures are unavailable." }, { status: 400 })
  }
  const byId = new Map(photos.map((photo) => [photo.id, photo]))

  try {
    const buffers = await Promise.all(ids.map(async (id) => {
      const photo = byId.get(id)
      if (!photo) throw new Error("HDR source exposure is unavailable")
      const blob = await download("originals", photo.storage_path, supabase)
      return Buffer.from(await blob.arrayBuffer())
    }))
    const fused = await fuseExposures(buffers)
    const metadata = await sharp(fused).metadata()
    const path = `${user.id}/${body.listingId}/${group.merge_photo_id}/hdr-merged.jpg`
    const admin = createAdminClient()
    try {
      await upload("originals", path, fused, "image/jpeg", admin)
    } catch (uploadError) {
      const existing = await info("originals", path, admin).catch(() => null)
      if (!existing || existing.size !== fused.byteLength) throw uploadError
    }
    const { data: photoId, error } = await admin.rpc("confirm_hdr_group", {
      p_group_id: group.id,
      p_user_id: user.id,
      p_storage_path: path,
      p_width: metadata.width ?? null,
      p_height: metadata.height ?? null,
      p_byte_size: fused.byteLength,
    })
    if (error) throw error
    return NextResponse.json({ photoId, groupId: group.id, status: "confirmed", idempotent: false })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "HDR merge failed" }, { status: 422 })
  }
}
