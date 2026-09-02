import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { loadProofingListing } from "@/lib/proofing-server"
import { ToolsNav } from "../tools-nav"
import { ProofingWorkspace } from "./proofing-workspace"

export default async function ProofingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ photo?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()
  const listing = await loadProofingListing(supabase, id)
  if (!listing) notFound()

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <Link href={`/listings/${id}`} className="text-sm text-muted-foreground hover:underline">
        ← {listing.address}
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ls-section-label text-muted-foreground">Full-shoot review</p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-[-0.035em]">Proofing</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {listing.mlsNumber && <p className="text-xs text-muted-foreground">MLS {listing.mlsNumber}</p>}
          <Link href={`/listings/${id}/delivery`} className="text-sm font-medium underline underline-offset-4">Prepare delivery →</Link>
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Compare every logical photo, choose the exact version, then approve it. Opening a photo never approves it.
      </p>
      <div className="mt-6"><ToolsNav listingId={id} /></div>
      <div className="mt-7">
        <ProofingWorkspace listingId={id} items={listing.items} scopedReworks={listing.scopedReworks} initialPhotoId={query.photo} />
      </div>
    </main>
  )
}
