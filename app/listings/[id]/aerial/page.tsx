import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import type { PhotoRow } from "../photo-grid"
import { ToolsNav } from "../tools-nav"
import { AerialPanel } from "./aerial-panel"

export default async function AerialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: listing }, { data: photos }] = await Promise.all([
    supabase.from("listings").select("id, address, mls_number").eq("id", id).single(),
    supabase
      .from("photos")
      .select("id, room_id, storage_path, is_floor_plan, width, height")
      .eq("listing_id", id)
      .order("created_at"),
  ])
  if (!listing) notFound()

  const regular = (photos ?? []).filter((p) => !p.is_floor_plan)
  const urls = await getUrls("originals", regular.map((p) => p.storage_path))
  const withUrls: PhotoRow[] = regular.map((p) => ({ ...p, url: urls[p.storage_path] ?? null }))

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
        <AerialPanel listingId={id} photos={withUrls} />
      </div>
    </main>
  )
}
