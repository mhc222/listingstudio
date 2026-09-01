import { NextResponse } from "next/server"
import { loadDeliveryPackageContext } from "@/lib/delivery-server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const profileId = new URL(req.url).searchParams.get("profileId")
  if (!profileId) return NextResponse.json({ error: "Choose a delivery profile." }, { status: 400 })
  try {
    const context = await loadDeliveryPackageContext(supabase, id, profileId)
    if (!context) return NextResponse.json({ error: "Listing or delivery profile not found." }, { status: 404 })
    return NextResponse.json({ preview: context.preview })
  } catch {
    return NextResponse.json({ error: "Could not prepare the delivery preview." }, { status: 500 })
  }
}
