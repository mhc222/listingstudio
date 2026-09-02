import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { PhotoGrid, type PhotoRow } from "../photo-grid"
import { ToolsNav } from "../tools-nav"
import { PlanPanel } from "./plan-panel"

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: listing }, { data: rooms }, { data: photos }] = await Promise.all([
    supabase.from("listings").select("id, address, mls_number").eq("id", id).single(),
    supabase.from("rooms").select("*").eq("listing_id", id).order("name"),
    supabase
      .from("photos")
      .select("id, room_id, storage_path, is_floor_plan, width, height")
      .eq("listing_id", id)
      .order("created_at"),
  ])
  if (!listing) notFound()

  const floorPlans = (photos ?? []).filter((p) => p.is_floor_plan)
  const urls = await getUrls("originals", floorPlans.map((p) => p.storage_path))
  const withUrls: PhotoRow[] = floorPlans.map((p) => ({ ...p, url: urls[p.storage_path] ?? null }))

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Link href="/listings" className="inline-flex min-h-10 items-center text-sm text-muted-foreground hover:underline">
        ← Listings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{listing.address}</h1>
      {listing.mls_number && (
        <p className="text-sm text-muted-foreground">MLS {listing.mls_number}</p>
      )}
      <div className="mt-6">
        <ToolsNav listingId={id} />
      </div>

      <div className="mt-6 grid gap-6">
        {withUrls.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-medium">Floor plans ({withUrls.length})</h2>
            <PhotoGrid photos={withUrls} rooms={rooms ?? []} listingId={id} />
          </section>
        )}
        <PlanPanel listingId={id} plans={withUrls.filter((p) => !p.storage_path.endsWith(".pdf"))} />
        {withUrls.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Upload a floor plan or hand sketch from the listing page (Photos → Attach floor plan) to
            redraw it here.
          </p>
        )}
      </div>
    </main>
  )
}
