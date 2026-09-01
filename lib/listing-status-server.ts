import "server-only"

import { createClient } from "@/lib/supabase/server"
import {
  deriveListingStatus,
  type ListingStatusInput,
  type ListingStatusSummary,
} from "@/lib/listing-status"

type ServerClient = Awaited<ReturnType<typeof createClient>>

export async function loadListingStatuses(
  supabase: ServerClient,
  listingIds: string[]
): Promise<Map<string, ListingStatusSummary>> {
  const uniqueIds = [...new Set(listingIds)]
  if (uniqueIds.length === 0) return new Map()

  const [uploadsQ, photoGroupsQ, roomRunsQ, roomProposalsQ, jobsQ] = await Promise.all([
    supabase
      .from("upload_items")
      .select("id, original_filename, status, error, is_floor_plan, upload_batches!inner(listing_id)")
      .in("upload_batches.listing_id", uniqueIds),
    supabase
      .from("photo_groups")
      .select("id, listing_id, state, photo_group_members(photo_id)")
      .in("listing_id", uniqueIds),
    supabase
      .from("room_analysis_runs")
      .select("id, listing_id, status, error, created_at")
      .in("listing_id", uniqueIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("room_proposals")
      .select("id, listing_id, photo_id, review_state, decision, photos(original_filename)")
      .in("listing_id", uniqueIds)
      .eq("is_current", true),
    supabase
      .from("jobs")
      .select(
        "id, listing_id, title, status, file_groups(id, primary_photo_id, step_status, last_error, output_versions(id, version_number, storage_path))"
      )
      .in("listing_id", uniqueIds),
  ])

  const inputs = new Map<string, ListingStatusInput>(
    uniqueIds.map((listingId) => [listingId, { listingId }])
  )

  for (const row of uploadsQ.data ?? []) {
    const batch = row.upload_batches as unknown as { listing_id: string } | null
    if (!batch || !inputs.has(batch.listing_id)) continue
    const input = inputs.get(batch.listing_id)!
    ;(input.uploadItems ??= []).push({
      id: row.id,
      originalFilename: row.original_filename,
      status: row.status,
      error: row.error,
      isFloorPlan: row.is_floor_plan,
    })
  }

  for (const row of photoGroupsQ.data ?? []) {
    const input = inputs.get(row.listing_id)
    if (!input) continue
    ;(input.photoGroups ??= []).push({
      id: row.id,
      state: row.state,
      memberCount: row.photo_group_members.length,
    })
  }

  for (const row of roomRunsQ.data ?? []) {
    const input = inputs.get(row.listing_id)
    if (!input) continue
    ;(input.roomAnalysisRuns ??= []).push({
      id: row.id,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
    })
  }

  for (const row of roomProposalsQ.data ?? []) {
    const input = inputs.get(row.listing_id)
    if (!input) continue
    const photo = row.photos as unknown as { original_filename: string | null } | null
    ;(input.roomProposals ??= []).push({
      id: row.id,
      photoId: row.photo_id,
      photoLabel: photo?.original_filename,
      reviewState: row.review_state,
      decision: row.decision,
    })
  }

  for (const row of jobsQ.data ?? []) {
    const input = inputs.get(row.listing_id)
    if (!input) continue
    ;(input.jobs ??= []).push({
      id: row.id,
      title: row.title,
      status: row.status,
      fileGroups: row.file_groups.map((group) => ({
        id: group.id,
        primaryPhotoId: group.primary_photo_id,
        stepStatus: group.step_status,
        lastError: group.last_error,
        outputVersions: group.output_versions.map((version) => ({
          id: version.id,
          versionNumber: version.version_number,
          accessible: Boolean(version.storage_path),
        })),
      })),
    })
  }

  return new Map(
    [...inputs].map(([listingId, input]) => [listingId, deriveListingStatus(input)])
  )
}
