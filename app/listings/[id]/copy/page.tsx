import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { CopyPanel, type CopyRow } from "./copy-panel"

export default async function CopyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: listing }, { data: photos }, { data: copies }] = await Promise.all([
    supabase.from("listings").select("id, address, mls_number").eq("id", id).single(),
    supabase
      .from("photos")
      .select("id, storage_path, is_floor_plan")
      .eq("listing_id", id)
      .order("created_at"),
    supabase.from("listing_copy").select("*").eq("listing_id", id),
  ])
  if (!listing) notFound()

  const regular = (photos ?? []).filter((p) => !p.is_floor_plan)
  const urls = await getUrls("originals", regular.map((p) => p.storage_path))
  const photoRows = regular.map((p) => ({ id: p.id, url: urls[p.storage_path] ?? null }))

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href={`/listings/${id}`} className="text-sm text-muted-foreground hover:underline">
        ← {listing.address}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Listing copy</h1>
      <p className="text-sm text-muted-foreground">
        Photos + facts → headline, 100-word, and 250-word MLS descriptions.
      </p>
      <div className="mt-6">
        <CopyPanel listingId={id} photos={photoRows} copies={(copies ?? []) as CopyRow[]} />
      </div>
    </main>
  )
}
