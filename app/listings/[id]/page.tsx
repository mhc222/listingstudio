import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getThumbUrls, getUrls } from "@/lib/storage"
import { UploadPanel } from "./upload-panel"
import { type PhotoRow } from "./photo-grid"
import { type JobRow, type SampleRow, type ComplianceNote } from "./job-feed"
import { ListingWorkspace } from "./listing-workspace"
import { ToolsNav } from "./tools-nav"
import { logicalPhotoIds } from "@/lib/hdr-groups"
import type { EditPresetDefaultRow, EditPresetRow } from "@/lib/edit-presets"
import { type PhotoGroupRow } from "./shoot-organization"
import {
  type RoomAnalysisRunRow,
  type RoomProposalRow,
  type SameRoomGroupRow,
} from "./room-organization"
import { loadListingStatuses } from "@/lib/listing-status-server"
import { ListingProgress } from "./listing-progress"

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: listing }, { data: rooms }, { data: photos }, { data: groups }, { data: members }, { data: jobs }, { data: samples }, { data: analysisRuns }, { data: roomProposals }, { data: sameRoomGroups }, { data: sameRoomMembers }, { data: presets }, { data: presetDefaults }] =
    await Promise.all([
      supabase.from("listings").select("id, address, mls_number").eq("id", id).single(),
      supabase.from("rooms").select("*").eq("listing_id", id).order("name"),
      supabase
        .from("photos")
        .select("id, room_id, storage_path, is_floor_plan, width, height, original_filename, source_batch_id, intake_order, captured_at, exposure_time_seconds, exposure_bias_ev, aperture_f_number, iso, focal_length_mm, camera_make, camera_model, lens_model, photo_role, hdr_group_id, hdr_decision")
        .eq("listing_id", id)
        .order("created_at"),
      supabase
        .from("photo_groups")
        .select("id, state, confidence, reason, representative_photo_id, created_at")
        .eq("listing_id", id)
        .in("state", ["proposed", "confirmed"])
        .order("created_at"),
      supabase
        .from("photo_group_members")
        .select("group_id, photo_id, position, photo_groups!inner(listing_id)")
        .eq("photo_groups.listing_id", id)
        .order("position"),
      supabase
        .from("jobs")
        .select(
          `id, title, status, kind, total_cost_cents, grounding_used,
         file_groups (id, primary_photo_id, current_step, step_status, last_error, edit_chain, comment,
           output_versions (id, version_number, parent_version_id, qa_note, storage_path),
           chat_messages (role, content, created_at))`
        )
        .eq("listing_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("sample_images")
        .select("id, label, storage_path, use_count")
        .order("use_count", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("room_analysis_runs").select("id, status, analyzed_photo_count, cost_cents, error, created_at").eq("listing_id", id).order("created_at", { ascending: false }).limit(1),
      supabase.from("room_proposals").select("id, run_id, photo_id, proposed_room_type, proposed_room_name, proposed_room_id, proposed_same_room_key, confidence, evidence, review_state, decision, accepted_room_id").eq("listing_id", id).eq("is_current", true),
      supabase.from("same_room_groups").select("id, room_id, name").eq("listing_id", id).order("created_at"),
      supabase.from("same_room_group_members").select("group_id, photo_id, position, same_room_groups!inner(listing_id)").eq("same_room_groups.listing_id", id).order("position"),
      supabase.from("edit_presets").select("id, name, edit_chain, size_preset, settings_summary, created_at, updated_at").order("name"),
      supabase.from("edit_preset_defaults").select("id, preset_id, scope_type, listing_id, room_id, created_at, updated_at").order("created_at"),
    ])
  if (!listing) notFound()
  const listingStatuses = await loadListingStatuses(supabase, [id])
  const listingStatus = listingStatuses.get(id)!

  const urls = await getUrls("originals", (photos ?? []).map((p) => p.storage_path))
  const thumbUrls = await getThumbUrls("originals", (photos ?? []).map((p) => p.storage_path))
  const withUrls: PhotoRow[] = (photos ?? []).map((p) => ({
    ...p,
    exposure_time_seconds: p.exposure_time_seconds === null ? null : Number(p.exposure_time_seconds),
    exposure_bias_ev: p.exposure_bias_ev === null ? null : Number(p.exposure_bias_ev),
    aperture_f_number: p.aperture_f_number === null ? null : Number(p.aperture_f_number),
    focal_length_mm: p.focal_length_mm === null ? null : Number(p.focal_length_mm),
    url: urls[p.storage_path] ?? null,
    thumb_url: thumbUrls[p.storage_path] ?? null,
  })) as PhotoRow[]
  const inventoryPhotos = withUrls.filter((p) => !p.is_floor_plan)
  const memberIdsByGroup = new Map<string, string[]>()
  for (const member of members ?? []) {
    const list = memberIdsByGroup.get(member.group_id) ?? []
    list.push(member.photo_id)
    memberIdsByGroup.set(member.group_id, list)
  }
  const photoGroups: PhotoGroupRow[] = (groups ?? []).map((group) => ({
    ...group,
    confidence: Number(group.confidence),
    memberPhotoIds: memberIdsByGroup.get(group.id) ?? [],
  })) as PhotoGroupRow[]
  const sameRoomMemberIds = new Map<string, string[]>()
  for (const member of sameRoomMembers ?? []) {
    const list = sameRoomMemberIds.get(member.group_id) ?? []
    list.push(member.photo_id)
    sameRoomMemberIds.set(member.group_id, list)
  }
  const sameRoomGroupRows: SameRoomGroupRow[] = (sameRoomGroups ?? []).map((group) => ({
    ...group,
    memberPhotoIds: sameRoomMemberIds.get(group.id) ?? [],
  }))
  const confirmed = photoGroups
    .filter((group) => group.state === "confirmed")
    .map((group) => ({ representative_photo_id: group.representative_photo_id, members: group.memberPhotoIds }))
  const logicalIds = new Set(logicalPhotoIds(inventoryPhotos, confirmed))
  const regular = inventoryPhotos.filter((photo) => logicalIds.has(photo.id))
  // floorPlans still passed to JobPanel for plan-fg before-image lookup; the
  // floor-plan grid + redraw tool now live on /plan.
  const floorPlans = withUrls.filter((p) => p.is_floor_plan)

  const outputPaths = (jobs ?? []).flatMap((j) =>
    j.file_groups.flatMap((fg) => fg.output_versions.map((v) => v.storage_path))
  )
  const outputUrls = await getUrls("outputs", outputPaths)
  const outputThumbUrls = await getThumbUrls("outputs", outputPaths)

  // MLS compliance checklists (phase 21) fetched separately: the column lands
  // in migration 0008, and putting it in the nested select above would error
  // the whole jobs query pre-migration. This one fails open (all null).
  const versionIds = (jobs ?? []).flatMap((j) =>
    j.file_groups.flatMap((fg) => fg.output_versions.map((v) => v.id))
  )
  const complianceById = new Map<string, ComplianceNote>()
  if (versionIds.length > 0) {
    const { data: complianceRows } = await supabase
      .from("output_versions")
      .select("id, compliance")
      .in("id", versionIds)
    for (const r of complianceRows ?? [])
      complianceById.set(r.id, (r.compliance as ComplianceNote) ?? null)
  }
  const sampleUrls = await getUrls("references", (samples ?? []).map((s) => s.storage_path))
  const sampleRows: SampleRow[] = (samples ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    use_count: s.use_count ?? 0,
    url: sampleUrls[s.storage_path] ?? null,
  }))
  const jobRows: JobRow[] = (jobs ?? []).map((j) => ({
    ...j,
    file_groups: j.file_groups.map((fg) => ({
      ...fg,
      output_versions: fg.output_versions.map((v) => ({
        id: v.id,
        version_number: v.version_number,
        parent_version_id: v.parent_version_id,
        qa_note: v.qa_note,
        compliance: complianceById.get(v.id) ?? null,
        url: outputUrls[v.storage_path] ?? null,
        thumb_url: outputThumbUrls[v.storage_path] ?? null,
      })),
    })),
  }))

  // hero cover (phase 29): first non-floor-plan photo by created_at asc
  const cover = regular.find((p) => p.url)

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <Link href="/listings" className="inline-flex min-h-10 items-center text-sm text-muted-foreground hover:underline">
        ← Listings
      </Link>

      {cover ? (
        <div className="relative mt-3 overflow-hidden rounded-[1.25rem] shadow-[var(--shadow-surface)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
          <img src={cover.url ?? ""} alt="" className="h-56 w-full object-cover sm:h-72" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute bottom-0 left-0 p-5">
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-primary-foreground drop-shadow sm:text-4xl">
              {listing.address}
            </h1>
            {listing.mls_number && (
              <p className="mt-1 font-ui text-xs uppercase tracking-wide text-primary-foreground/80">
                MLS {listing.mls_number}
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <h1 className="mt-2 text-2xl font-semibold">{listing.address}</h1>
          {listing.mls_number && (
            <p className="text-sm text-muted-foreground">MLS {listing.mls_number}</p>
          )}
        </>
      )}

      <div className="mt-6">
        <ToolsNav listingId={id} />
      </div>

      <div className="mt-6">
        <ListingProgress
          listingId={id}
          summary={listingStatus}
          scope={{
            jobIds: (jobs ?? []).map((j) => j.id),
            fileGroupIds: (jobs ?? []).flatMap((j) => j.file_groups.map((fg) => fg.id)),
          }}
        />
      </div>

      <div className="mt-6">
        <UploadPanel
          listingId={id}
          presets={(presets ?? []) as EditPresetRow[]}
          presetDefaults={(presetDefaults ?? []) as EditPresetDefaultRow[]}
        />
      </div>

      <div className="mt-6">
        <ListingWorkspace
          listingId={id}
          photos={regular}
          inventoryPhotos={inventoryPhotos}
          photoGroups={photoGroups}
          latestRoomAnalysis={(analysisRuns?.[0] as RoomAnalysisRunRow | undefined) ?? null}
          roomProposals={(roomProposals ?? []).map((proposal) => ({ ...proposal, confidence: Number(proposal.confidence) })) as RoomProposalRow[]}
          sameRoomGroups={sameRoomGroupRows}
          floorPlans={floorPlans}
          rooms={rooms ?? []}
          jobs={jobRows}
          samples={sampleRows}
          presets={(presets ?? []) as EditPresetRow[]}
          presetDefaults={(presetDefaults ?? []) as EditPresetDefaultRow[]}
        />
      </div>
    </main>
  )
}
