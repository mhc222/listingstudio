import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { UploadPanel } from "./upload-panel"
import { type PhotoRow } from "./photo-grid"
import { type JobRow, type SampleRow, type ComplianceNote } from "./job-feed"
import { ListingWorkspace } from "./listing-workspace"
import { ToolsNav } from "./tools-nav"

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: listing }, { data: rooms }, { data: photos }, { data: jobs }, { data: samples }] =
    await Promise.all([
      supabase.from("listings").select("id, address, mls_number").eq("id", id).single(),
      supabase.from("rooms").select("*").eq("listing_id", id).order("name"),
      supabase
        .from("photos")
        .select("id, room_id, storage_path, is_floor_plan, width, height")
        .eq("listing_id", id)
        .order("created_at"),
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
    ])
  if (!listing) notFound()

  const urls = await getUrls("originals", (photos ?? []).map((p) => p.storage_path))
  const withUrls: PhotoRow[] = (photos ?? []).map((p) => ({ ...p, url: urls[p.storage_path] ?? null }))
  const regular = withUrls.filter((p) => !p.is_floor_plan)
  // floorPlans still passed to JobPanel for plan-fg before-image lookup; the
  // floor-plan grid + redraw tool now live on /plan.
  const floorPlans = withUrls.filter((p) => p.is_floor_plan)

  const outputPaths = (jobs ?? []).flatMap((j) =>
    j.file_groups.flatMap((fg) => fg.output_versions.map((v) => v.storage_path))
  )
  const outputUrls = await getUrls("outputs", outputPaths)

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
      })),
    })),
  }))

  // hero cover (phase 29): first non-floor-plan photo by created_at asc
  const cover = regular.find((p) => p.url)

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <Link href="/listings" className="text-sm text-muted-foreground hover:underline">
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
        <UploadPanel listingId={id} />
      </div>

      <div className="mt-6">
        <ListingWorkspace
          listingId={id}
          photos={regular}
          floorPlans={floorPlans}
          rooms={rooms ?? []}
          jobs={jobRows}
          samples={sampleRows}
        />
      </div>
    </main>
  )
}
