import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Phase 50 deliberately disables the old archive because it selected the
// newest output from every completed FileGroup, including abandoned branches.
// Phase 51 replaces this endpoint with an approved-final-only package preview
// and bounded archive implementation. Individual downloads remain available.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // RLS-scoped read proves ownership
  const { data: listing } = await supabase
    .from("listings")
    .select("id")
    .eq("id", id)
    .single()
  if (!listing) return NextResponse.json({ error: "not found" }, { status: 404 })

  return NextResponse.json(
    {
      error: "Listing archives are temporarily unavailable while approved-final delivery is being prepared. Download individual approved photos from Proofing.",
      proofingHref: `/listings/${id}/proofing`,
    },
    { status: 410 }
  )
}
