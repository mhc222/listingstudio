import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { JobFeed, type ComplianceNote, type JobRow } from "../job-feed"
import { type PhotoRow } from "../photo-grid"
import { ToolsNav } from "../tools-nav"

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [{ data: listing }, { data: photos }, { data: jobs }] = await Promise.all([
    supabase.from("listings").select("id, address").eq("id", id).single(),
    supabase
      .from("photos")
      .select("id, room_id, storage_path, is_floor_plan, width, height")
      .eq("listing_id", id)
      .order("created_at"),
    supabase
      .from("jobs")
      .select(
        `id, title, status, kind, created_at, total_cost_cents, grounding_used,
         file_groups (id, primary_photo_id, current_step, step_status, last_error, edit_chain, comment,
           output_versions (id, version_number, parent_version_id, qa_note, storage_path),
           chat_messages (role, content, created_at))`
      )
      .eq("listing_id", id)
      .order("created_at", { ascending: false }),
  ])
  if (!listing) notFound()

  const originalUrls = await getUrls("originals", (photos ?? []).map((photo) => photo.storage_path))
  const withUrls: PhotoRow[] = (photos ?? []).map((photo) => ({
    ...photo,
    url: originalUrls[photo.storage_path] ?? null,
  }))
  const regular = withUrls.filter((photo) => !photo.is_floor_plan)
  const floorPlans = withUrls.filter((photo) => photo.is_floor_plan)

  const outputPaths = (jobs ?? []).flatMap((job) =>
    job.file_groups.flatMap((group) => group.output_versions.map((version) => version.storage_path))
  )
  const outputUrls = await getUrls("outputs", outputPaths)
  const versionIds = (jobs ?? []).flatMap((job) =>
    job.file_groups.flatMap((group) => group.output_versions.map((version) => version.id))
  )
  const complianceById = new Map<string, ComplianceNote>()
  if (versionIds.length > 0) {
    const { data: rows } = await supabase
      .from("output_versions")
      .select("id, compliance")
      .in("id", versionIds)
    for (const row of rows ?? [])
      complianceById.set(row.id, (row.compliance as ComplianceNote) ?? null)
  }

  const jobRows: JobRow[] = (jobs ?? []).map((job) => ({
    ...job,
    file_groups: job.file_groups.map((group) => ({
      ...group,
      output_versions: group.output_versions.map((version) => ({
        id: version.id,
        version_number: version.version_number,
        parent_version_id: version.parent_version_id,
        qa_note: version.qa_note,
        compliance: complianceById.get(version.id) ?? null,
        url: outputUrls[version.storage_path] ?? null,
      })),
    })),
  }))

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <Link href={`/listings/${id}`} className="text-sm text-muted-foreground hover:underline">
        ← {listing.address}
      </Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Activity</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Edits in progress and completed images for this listing.
      </p>
      <div className="mt-6">
        <ToolsNav listingId={id} />
      </div>
      <div className="mt-8">
        <JobFeed listingId={id} photos={regular} floorPlans={floorPlans} jobs={jobRows} />
      </div>
    </main>
  )
}
