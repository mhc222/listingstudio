import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Create a tour on a listing. RLS validates listing ownership on insert.
// TODO(resume) phase 12: no UI calls this yet — components/tour-viewer.tsx,
// app/listings/[id]/tour-panel.tsx and app/tour/[slug]/page.tsx are unbuilt.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { listingId, title } = await req.json().catch(() => ({}))
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 })

  const { data, error } = await supabase
    .from("tours")
    .insert({ listing_id: listingId, ...(title ? { title } : {}) })
    .select("id, title, slug")
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ tour: data })
}
