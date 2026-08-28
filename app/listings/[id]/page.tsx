import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { UploadPanel } from "./upload-panel"
import { PhotoGrid, type PhotoRow } from "./photo-grid"
import { RoomPanel, type RoomRow } from "./room-panel"

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: listing }, { data: rooms }, { data: photos }] = await Promise.all([
    supabase.from("listings").select("id, address, mls_number").eq("id", id).single(),
    supabase.from("rooms").select("*").eq("listing_id", id).order("name"),
    supabase
      .from("photos")
      .select("id, room_id, storage_path, is_floor_plan")
      .eq("listing_id", id)
      .order("created_at"),
  ])
  if (!listing) notFound()

  const urls = await getUrls("originals", (photos ?? []).map((p) => p.storage_path))
  const withUrls: PhotoRow[] = (photos ?? []).map((p) => ({ ...p, url: urls[p.storage_path] ?? null }))
  const regular = withUrls.filter((p) => !p.is_floor_plan)
  const floorPlans = withUrls.filter((p) => p.is_floor_plan)

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Link href="/listings" className="text-sm text-muted-foreground hover:underline">
        ← Listings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{listing.address}</h1>
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
            </section>
          )}
        </div>
        <aside>
          <h2 className="mb-3 text-lg font-medium">Rooms</h2>
          <RoomPanel listingId={id} rooms={(rooms ?? []) as RoomRow[]} />
        </aside>
      </div>
    </main>
  )
}
