import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { ToolsNav } from "../tools-nav"
import { TourPanel, type TourRow } from "./tour-panel"

export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: listing }, { data: tours }] = await Promise.all([
    supabase.from("listings").select("id, address, mls_number").eq("id", id).single(),
    supabase
      .from("tours")
      .select(
        "id, title, slug, tour_scenes (id, name, storage_path, width, order_index, initial_yaw, hotspots)"
      )
      .eq("listing_id", id)
      .order("created_at"),
  ])
  if (!listing) notFound()

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
      <div className="mt-6">
        <TourPanel listingId={id} tours={tourRows} />
      </div>
    </main>
  )
}
