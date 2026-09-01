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
  const admin = createAdminClient()
  const proposalIds = decisions.map((decision) => decision.proposal_id!)
  const { data: proposalRows } = await admin.from("room_proposals")
    .select("id, photo_id, proposed_same_room_key").eq("listing_id", listingId).eq("is_current", true).in("id", proposalIds)
  if ((proposalRows ?? []).length !== proposalIds.length) return NextResponse.json({ error: "One or more current proposals were not found." }, { status: 404 })
  const proposalById = new Map((proposalRows ?? []).map((proposal) => [proposal.id, proposal]))
  const photoIds = (proposalRows ?? []).map((proposal) => proposal.photo_id)
  const { data: priorMemberships } = await admin.from("same_room_group_members").select("group_id, photo_id").in("photo_id", photoIds)

  // The initially applied 0011 function cleaned every singleton group when an
  // accepted decision had no same-room key. Use a temporary unique key for
  // true singletons, then remove only that temporary group. Fresh installs
  // also contain the narrower SQL fix, so this remains harmless compatibility.
  const syntheticKeys: string[] = []
  const rpcDecisions = decisions.map((decision) => {
    if (decision.action !== "accept") return decision
    const proposal = proposalById.get(decision.proposal_id!)!
    const hasOverride = Object.prototype.hasOwnProperty.call(decision, "same_room_key")
    const effectiveKey = hasOverride ? decision.same_room_key : proposal.proposed_same_room_key
    if (effectiveKey) return decision
    const synthetic = `single-${decision.proposal_id}`
    syntheticKeys.push(synthetic)
    return { ...decision, same_room_key: synthetic }
  })

  const { data, error } = await admin.rpc("apply_room_proposal_decisions", {
    p_listing_id: listingId,
    p_user_id: user.id,
    p_decisions: rpcDecisions,
  })
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "22023" || error.code === "55000" ? 409 : 500
    return NextResponse.json({ error: status === 500 ? "Room decisions could not be saved." : error.message }, { status })
  }
  if (syntheticKeys.length) {
    await admin.from("same_room_groups").delete().eq("listing_id", listingId).in("proposal_key", syntheticKeys)
  }
  for (const membership of priorMemberships ?? []) {
    const { count } = await admin.from("same_room_group_members").select("photo_id", { count: "exact", head: true }).eq("group_id", membership.group_id)
    if ((count ?? 0) < 2) await admin.from("same_room_groups").delete().eq("id", membership.group_id).eq("listing_id", listingId)
  }
  return NextResponse.json(data?.[0] ?? { accepted_count: 0, deferred_count: 0 })
}
