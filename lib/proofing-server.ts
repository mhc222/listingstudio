import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { logicalPhotoIds } from "@/lib/hdr-groups"
import { getUrls } from "@/lib/storage"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ComplianceNote } from "@/app/listings/[id]/job-feed"

export type ProofingVersionRow = {
  id: string
  fileGroupId: string
  jobTitle: string
  versionNumber: number
  versionLabel: string | null
  parentVersionId: string | null
  variationIndex: number | null
  createdAt: string
  reviewState: "unreviewed" | "needs_changes" | "approved"
  reviewNote: string | null
  reviewedAt: string | null
  qaNote: string | null
  qaNeedsReview: boolean
  url: string | null
}

export type ProofingItemRow = {
  id: string
  roomId: string | null
  roomName: string
  filename: string
  originalUrl: string | null
  final: {
    id: string
    outputVersionId: string | null
    selectedAt: string
  } | null
  groups: {
    id: string
    status: string
    error: string | null
  }[]
  versions: ProofingVersionRow[]
}

export type ProofingListing = {
  id: string
  address: string
  mlsNumber: string | null
  items: ProofingItemRow[]
}

export async function loadProofingListing(
  supabase: SupabaseClient,
  listingId: string
): Promise<ProofingListing | null> {
  const [listingQ, roomsQ, photosQ, groupsQ, membersQ, jobsQ, finalsQ] = await Promise.all([
    supabase.from("listings").select("id, address, mls_number").eq("id", listingId).single(),
    supabase.from("rooms").select("id, name").eq("listing_id", listingId),
    supabase
      .from("photos")
      .select("id, room_id, storage_path, original_filename, is_floor_plan, photo_role, intake_order, created_at")
      .eq("listing_id", listingId)
      .order("intake_order", { nullsFirst: false })
      .order("created_at"),
    supabase
      .from("photo_groups")
      .select("id, state, representative_photo_id")
      .eq("listing_id", listingId)
      .eq("state", "confirmed"),
    supabase
      .from("photo_group_members")
      .select("group_id, photo_id, photo_groups!inner(listing_id)")
      .eq("photo_groups.listing_id", listingId),
    supabase
      .from("jobs")
      .select(
        `id, title, file_groups (id, primary_photo_id, step_status, last_error, variation_index,
          output_versions (id, version_number, version_label, parent_version_id, storage_path, qa_note, compliance, created_at, review_state, review_note, reviewed_at))`
      )
      .eq("listing_id", listingId),
    supabase
      .from("photo_finals")
      .select("id, source_photo_id, output_version_id, selected_at")
      .eq("listing_id", listingId),
  ])

  if (!listingQ.data) return null
  if (photosQ.error || groupsQ.error || membersQ.error || jobsQ.error || finalsQ.error) {
    throw new Error(
      photosQ.error?.message || groupsQ.error?.message || membersQ.error?.message ||
      jobsQ.error?.message || finalsQ.error?.message || "Could not load proofing data"
    )
  }
  // The listing query above is RLS-scoped. Sign only the paths discovered
  // through those owned rows, while retaining support for legacy output paths.
  const storageClient = createAdminClient()

  const membersByGroup = new Map<string, string[]>()
  for (const member of membersQ.data ?? []) {
    const list = membersByGroup.get(member.group_id) ?? []
    list.push(member.photo_id)
    membersByGroup.set(member.group_id, list)
  }
  const confirmed = (groupsQ.data ?? []).map((group) => ({
    representative_photo_id: group.representative_photo_id,
    members: membersByGroup.get(group.id) ?? [],
  }))
  const logicalIds = new Set(logicalPhotoIds(photosQ.data ?? [], confirmed))
  const logicalPhotos = (photosQ.data ?? []).filter((photo) => logicalIds.has(photo.id))
  const roomNames = new Map((roomsQ.data ?? []).map((room) => [room.id, room.name]))

  const originalUrls = await getUrls(
    "originals",
    logicalPhotos.map((photo) => photo.storage_path),
    3600,
    storageClient
  )
  const outputPaths = (jobsQ.data ?? []).flatMap((job) =>
    job.file_groups.flatMap((group) => group.output_versions.map((version) => version.storage_path))
  )
  const outputUrls = await getUrls("outputs", outputPaths, 3600, storageClient)
  const finalsByPhoto = new Map((finalsQ.data ?? []).map((final) => [final.source_photo_id, final]))

  const groupsByPhoto = new Map<string, ProofingItemRow["groups"]>()
  const versionsByPhoto = new Map<string, ProofingVersionRow[]>()
  for (const job of jobsQ.data ?? []) {
    for (const group of job.file_groups) {
      if (!logicalIds.has(group.primary_photo_id)) continue
      const groupList = groupsByPhoto.get(group.primary_photo_id) ?? []
      groupList.push({ id: group.id, status: group.step_status, error: group.last_error })
      groupsByPhoto.set(group.primary_photo_id, groupList)

      const versionList = versionsByPhoto.get(group.primary_photo_id) ?? []
      for (const version of group.output_versions) {
        const compliance = version.compliance as ComplianceNote
        versionList.push({
          id: version.id,
          fileGroupId: group.id,
          jobTitle: job.title,
          versionNumber: version.version_number,
          versionLabel: version.version_label,
          parentVersionId: version.parent_version_id,
          variationIndex: group.variation_index,
          createdAt: version.created_at,
          reviewState: version.review_state,
          reviewNote: version.review_note,
          reviewedAt: version.reviewed_at,
          qaNote: version.qa_note,
          qaNeedsReview:
            Boolean(version.qa_note) || Boolean(compliance?.checks?.some((check) => !check.pass)),
          url: outputUrls[version.storage_path] ?? null,
        })
      }
      versionsByPhoto.set(group.primary_photo_id, versionList)
    }
  }

  return {
    id: listingQ.data.id,
    address: listingQ.data.address,
    mlsNumber: listingQ.data.mls_number,
    items: logicalPhotos.map((photo) => {
      const final = finalsByPhoto.get(photo.id)
      return {
        id: photo.id,
        roomId: photo.room_id,
        roomName: photo.room_id ? roomNames.get(photo.room_id) ?? "Room" : "Untagged",
        filename: photo.original_filename?.trim() || `Photo ${photo.id.slice(0, 8)}`,
        originalUrl: originalUrls[photo.storage_path] ?? null,
        final: final
          ? { id: final.id, outputVersionId: final.output_version_id, selectedAt: final.selected_at }
          : null,
        groups: groupsByPhoto.get(photo.id) ?? [],
        versions: versionsByPhoto.get(photo.id) ?? [],
      }
    }),
  }
}
