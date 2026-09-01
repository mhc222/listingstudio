import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { buildDeliveryPreview, type DeliveryCandidate, type DeliveryProfileRow } from "@/lib/delivery"
import { isStaged } from "@/lib/deliver"
import { logicalPhotoIds } from "@/lib/hdr-groups"

type PhotoRow = {
  id: string
  room_id: string | null
  storage_path: string
  original_filename: string | null
  width: number | null
  height: number | null
  is_floor_plan: boolean
  photo_role: string
  intake_order: number | null
  created_at: string
}

type JobRow = {
  file_groups: Array<{
    primary_photo_id: string
    edit_chain: Array<{ edit_type: string }>
    output_versions: Array<{
      id: string
      version_number: number
      storage_path: string
      qa_note: string | null
      compliance: DeliveryCandidate["compliance"]
      review_state: string
    }>
  }>
}

export type DeliveryPackageContext = {
  preview: ReturnType<typeof buildDeliveryPreview>
  candidates: DeliveryCandidate[]
}

export async function loadDeliveryPackageContext(
  supabase: SupabaseClient,
  listingId: string,
  profileId: string
): Promise<DeliveryPackageContext | null> {
  const [listingQ, profileQ, roomsQ, photosQ, groupsQ, membersQ, jobsQ, finalsQ] = await Promise.all([
    supabase.from("listings").select("id, address").eq("id", listingId).maybeSingle(),
    supabase
      .from("delivery_profiles")
      .select("id, name, file_format, max_width, max_height, quality, max_bytes, disclosure_mode, naming_pattern, ordering, created_at, updated_at")
      .eq("id", profileId)
      .maybeSingle(),
    supabase.from("rooms").select("id, name").eq("listing_id", listingId),
    supabase
      .from("photos")
      .select("id, room_id, storage_path, original_filename, width, height, is_floor_plan, photo_role, intake_order, created_at")
      .eq("listing_id", listingId)
      .order("intake_order", { nullsFirst: false })
      .order("created_at"),
    supabase
      .from("photo_groups")
      .select("id, representative_photo_id")
      .eq("listing_id", listingId)
      .eq("state", "confirmed"),
    supabase
      .from("photo_group_members")
      .select("group_id, photo_id, photo_groups!inner(listing_id)")
      .eq("photo_groups.listing_id", listingId),
    supabase
      .from("jobs")
      .select(`file_groups (primary_photo_id, edit_chain,
        output_versions (id, version_number, storage_path, qa_note, compliance, review_state))`)
      .eq("listing_id", listingId),
    supabase
      .from("photo_finals")
      .select("id, source_photo_id, output_version_id, selected_at")
      .eq("listing_id", listingId),
  ])

  if (!listingQ.data || !profileQ.data) return null
  const error = roomsQ.error || photosQ.error || groupsQ.error || membersQ.error || jobsQ.error || finalsQ.error
  if (error) throw new Error(error.message || "Could not load delivery package data.")

  const photos = (photosQ.data ?? []) as PhotoRow[]
  const membersByGroup = new Map<string, string[]>()
  for (const member of membersQ.data ?? []) {
    const members = membersByGroup.get(member.group_id) ?? []
    members.push(member.photo_id)
    membersByGroup.set(member.group_id, members)
  }
  const logicalIds = new Set(logicalPhotoIds(photos, (groupsQ.data ?? []).map((group) => ({
    representative_photo_id: group.representative_photo_id,
    members: membersByGroup.get(group.id) ?? [],
  }))))
  const roomNames = new Map((roomsQ.data ?? []).map((room) => [room.id, room.name]))
  const finals = new Map((finalsQ.data ?? []).map((row) => [row.source_photo_id, row]))

  const versions = new Map<string, {
    primaryPhotoId: string
    versionNumber: number
    storagePath: string
    qaNote: string | null
    compliance: DeliveryCandidate["compliance"]
    reviewState: string
    staged: boolean
  }>()
  for (const job of (jobsQ.data ?? []) as JobRow[]) {
    for (const group of job.file_groups) {
      for (const version of group.output_versions) {
        versions.set(version.id, {
          primaryPhotoId: group.primary_photo_id,
          versionNumber: version.version_number,
          storagePath: version.storage_path,
          qaNote: version.qa_note,
          compliance: version.compliance,
          reviewState: version.review_state,
          staged: isStaged(group.edit_chain),
        })
      }
    }
  }

  const candidates: DeliveryCandidate[] = photos
    .filter((photo) => logicalIds.has(photo.id))
    .map((photo) => {
      const final = finals.get(photo.id) ?? null
      const selectedVersion = final?.output_version_id ? versions.get(final.output_version_id) ?? null : null
      const wrongLineage = selectedVersion && selectedVersion.primaryPhotoId !== photo.id
      const selectionIssue = final?.output_version_id && !selectedVersion
        ? `${photo.original_filename || "A photo"} points to an unavailable approved version.`
        : wrongLineage
          ? `${photo.original_filename || "A photo"} points to an approved version from another source.`
          : null
      return {
        sourcePhotoId: photo.id,
        originalFilename: photo.original_filename?.trim() || `photo-${photo.id.slice(0, 8)}.jpg`,
        roomName: photo.room_id ? roomNames.get(photo.room_id) ?? "Room" : "Untagged",
        intakeOrder: photo.intake_order,
        width: photo.width,
        height: photo.height,
        finalId: final?.id ?? null,
        selectedAt: final?.selected_at ?? null,
        outputVersionId: final?.output_version_id ?? null,
        versionNumber: selectedVersion?.versionNumber ?? null,
        reviewState: selectedVersion?.reviewState ?? null,
        qaNote: selectedVersion?.qaNote ?? null,
        compliance: selectedVersion?.compliance ?? null,
        staged: selectedVersion?.staged ?? false,
        bucket: selectedVersion ? "outputs" : "originals",
        storagePath: selectedVersion?.storagePath ?? photo.storage_path,
        selectionIssue,
      }
    })

  const profile = profileQ.data as DeliveryProfileRow
  return {
    preview: buildDeliveryPreview({ listingId, address: listingQ.data.address, profile, candidates }),
    candidates,
  }
}
