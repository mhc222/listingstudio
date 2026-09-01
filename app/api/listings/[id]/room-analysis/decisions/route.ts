import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Decision = {
  proposal_id?: string
  action?: "accept" | "defer"
  room_id?: string | null
  room_name?: string
  room_type?: string
  same_room_key?: string | null
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { data: listing } = await supabase.from("listings").select("id").eq("id", listingId).single()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { decisions?: Decision[] } | null
  const decisions = body?.decisions
  if (!Array.isArray(decisions) || !decisions.length || decisions.length > 100) {
    return NextResponse.json({ error: "1-100 decisions required" }, { status: 400 })
  }
  if (decisions.some((decision) => !decision.proposal_id || !["accept", "defer"].includes(decision.action ?? ""))) {
    return NextResponse.json({ error: "Each decision needs a proposal and action." }, { status: 400 })
  }
  const { data, error } = await createAdminClient().rpc("apply_room_proposal_decisions", {
    p_listing_id: listingId,
    p_user_id: user.id,
    p_decisions: decisions,
  })
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "22023" || error.code === "55000" ? 409 : 500
    return NextResponse.json({ error: status === 500 ? "Room decisions could not be saved." : error.message }, { status })
  }
  return NextResponse.json(data?.[0] ?? { accepted_count: 0, deferred_count: 0 })
}
