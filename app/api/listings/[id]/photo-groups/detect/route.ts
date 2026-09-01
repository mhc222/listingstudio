import { NextResponse } from "next/server"
import sharp from "sharp"
import { detectHdrGroups, type HdrCandidatePhoto } from "@/lib/hdr-groups"
import { download } from "@/lib/storage"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 120

function needsLuminance(photo: HdrCandidatePhoto) {
  return photo.exposureBiasEv === null && !(photo.exposureTimeSeconds && photo.apertureFNumber && photo.iso)
}
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { data: listing } = await supabase.from("listings").select("id").eq("id", listingId).maybeSingle()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  const [{ data: photos, error: photoError }, { data: memberships }] = await Promise.all([
    supabase.from("photos")
      .select("id, storage_path, source_batch_id, intake_order, captured_at, width, height, exposure_time_seconds, exposure_bias_ev, aperture_f_number, iso, focal_length_mm, camera_make, camera_model, lens_model")
      .eq("listing_id", listingId).eq("is_floor_plan", false).eq("photo_role", "source")
      .eq("hdr_decision", "unreviewed").order("created_at"),
    supabase.from("photo_group_members").select("photo_id, photo_groups!inner(listing_id)").eq("photo_groups.listing_id", listingId),
  ])
  if (photoError) return NextResponse.json({ error: photoError.message }, { status: 500 })
  const grouped = new Set((memberships ?? []).map((member) => member.photo_id))
  const candidates = (photos ?? []).filter((photo) => !grouped.has(photo.id)).map((photo) => ({
    id: photo.id,
    sourceBatchId: photo.source_batch_id,
    intakeOrder: photo.intake_order,
    capturedAt: photo.captured_at,
    width: photo.width,
    height: photo.height,
    exposureTimeSeconds: photo.exposure_time_seconds === null ? null : Number(photo.exposure_time_seconds),
    exposureBiasEv: photo.exposure_bias_ev === null ? null : Number(photo.exposure_bias_ev),
    apertureFNumber: photo.aperture_f_number === null ? null : Number(photo.aperture_f_number),
    iso: photo.iso,
    focalLengthMm: photo.focal_length_mm === null ? null : Number(photo.focal_length_mm),
    cameraMake: photo.camera_make,
    cameraModel: photo.camera_model,
    lensModel: photo.lens_model,
    storagePath: photo.storage_path,
    luminance: null,
  })) as Array<HdrCandidatePhoto & { storagePath: string }>

  // Brightness is a bounded fallback only for timed candidate frames with
  // incomplete exposure EXIF. It never groups an untimed folder by appearance.
  await Promise.all(candidates.filter(needsLuminance).map(async (photo) => {
    try {
      const blob = await download("originals", photo.storagePath, supabase)
      const stats = await sharp(Buffer.from(await blob.arrayBuffer())).resize({ width: 96, withoutEnlargement: true }).stats()
      photo.luminance = (0.2126 * stats.channels[0].mean + 0.7152 * stats.channels[1].mean + 0.0722 * stats.channels[2].mean) / 255
    } catch {
      photo.luminance = null
    }
  }))

  const created: string[] = []
  for (const proposal of detectHdrGroups(candidates)) {
    const { data: group, error } = await supabase.from("photo_groups").insert({
      listing_id: listingId, confidence: proposal.confidence, reason: proposal.reason,
    }).select("id").single()
    if (error || !group) continue
    const { error: memberError } = await supabase.from("photo_group_members").insert(
      proposal.memberPhotoIds.map((photoId, index) => ({ group_id: group.id, photo_id: photoId, position: index + 1 }))
    )
    if (memberError) {
      await supabase.from("photo_groups").delete().eq("id", group.id)
      continue
    }
    created.push(group.id)
  }
  return NextResponse.json({ proposed: created.length, groupIds: created })
}
