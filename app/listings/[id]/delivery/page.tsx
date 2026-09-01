import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ToolsNav } from "../tools-nav"
import { DeliveryWorkspace } from "./delivery-workspace"

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: listing } = await supabase
    .from("listings")
    .select("id, address, mls_number")
    .eq("id", id)
    .maybeSingle()
  if (!listing) notFound()

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <Link href={`/listings/${id}/proofing`} className="text-sm text-muted-foreground hover:underline">
        ← Proofing
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ls-section-label text-muted-foreground">Approved finals</p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-[-0.035em]">Delivery</h1>
        </div>
        {listing.mls_number && <p className="text-xs text-muted-foreground">MLS {listing.mls_number}</p>}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Preview the exact approved originals and versions, then create a reproducible MLS or client package. No latest-version fallback is used.
      </p>
      <div className="mt-6"><ToolsNav listingId={id} /></div>
      <div className="mt-7">
        <DeliveryWorkspace listingId={id} address={listing.address} />
      </div>
    </main>
  )
}
