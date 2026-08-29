import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { UploadPanel } from "./upload-panel"
import { PhotoGrid, type PhotoRow } from "./photo-grid"
import { RoomPanel, type RoomRow } from "./room-panel"
import { JobPanel, type JobRow, type SampleRow } from "./job-panel"
import { PlanPanel } from "./plan-panel"
import { TourPanel, type TourRow } from "./tour-panel"
import { AerialPanel } from "./aerial-panel"

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: listing },
    { data: rooms },
    { data: photos },
    { data: jobs },
    { data: samples },
    { data: tours },
  ] = await Promise.all([
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
      supabase
        .from("tours")
        .select(
          "id, title, slug, tour_scenes (id, name, storage_path, width, order_index, initial_yaw, hotspots)"
        )
        .eq("listing_id", id)
        .order("created_at"),
    ])
  if (!listing) notFound()

  const urls = await getUrls("originals", (photos ?? []).map((p) => p.storage_path))
  const withUrls: PhotoRow[] = (photos ?? []).map((p) => ({ ...p, url: urls[p.storage_path] ?? null }))
  const regular = withUrls.filter((p) => !p.is_floor_plan)
  const floorPlans = withUrls.filter((p) => p.is_floor_plan)

  const outputPaths = (jobs ?? []).flatMap((j) =>
    j.file_groups.flatMap((fg) => fg.output_versions.map((v) => v.storage_path))
  )
  const outputUrls = await getUrls("outputs", outputPaths)
  const sampleUrls = await getUrls("references", (samples ?? []).map((s) => s.storage_path))
  const scenePaths = (tours ?? []).flatMap((t) => t.tour_scenes.map((s) => s.storage_path))
  const sceneUrls = await getUrls("originals", scenePaths)
  const tourRows: TourRow[] = (tours ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    slug: t.slug,
    scenes: [...t.tour_scenes]
      .sort((a, b) => a.order_index - b.order_index)
      .map((s) => ({
        id: s.id,
        name: s.name,
        url: sceneUrls[s.storage_path] ?? null,
        width: s.width,
        initial_yaw: s.initial_yaw,
        hotspots: s.hotspots ?? [],
      })),
  }))
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
        url: outputUrls[v.storage_path] ?? null,
      })),
    })),
  }))

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Link href="/listings" className="text-sm text-muted-foreground hover:underline">
        ← Listings
      </Link>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">{listing.address}</h1>
        <Link href={`/listings/${id}/copy`} className="text-sm text-primary hover:underline">
          Listing copy →
        </Link>
      </div>
      {listing.mls_number && (
        <p className="text-sm text-muted-foreground">MLS {listing.mls_number}</p>
      )}

      <div className="mt-6">
        <UploadPanel listingId={id} rooms={rooms ?? []} />
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-8">
          <section>
            <h2 className="mb-3 text-lg font-medium">Photos ({regular.length})</h2>
            <PhotoGrid photos={regular} rooms={rooms ?? []} listingId={id} />
          </section>
          {floorPlans.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-medium">Floor plans ({floorPlans.length})</h2>
              <PhotoGrid photos={floorPlans} rooms={rooms ?? []} listingId={id} />
              <PlanPanel
                listingId={id}
                plans={floorPlans.filter((p) => !p.storage_path.endsWith(".pdf"))}
              />
            </section>
          )}
          <AerialPanel listingId={id} photos={regular} />
          <TourPanel listingId={id} tours={tourRows} />
          <JobPanel
            listingId={id}
            photos={regular}
            floorPlans={floorPlans}
            jobs={jobRows}
            samples={sampleRows}
          />
        </div>
        <aside>
          <h2 className="mb-3 text-lg font-medium">Rooms</h2>
          <RoomPanel listingId={id} rooms={(rooms ?? []) as RoomRow[]} />
        </aside>
      </div>
    </main>
  )
}
