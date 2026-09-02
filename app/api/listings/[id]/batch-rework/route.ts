import { NextResponse } from "next/server"
import { MODELS, type ProviderKey } from "@/config/models"
import { submitStep } from "@/lib/orchestrator"
import type { EditStep } from "@/lib/prompts"
import {
  buildScopedReworkSnapshot,
  validateScopedReworkInput,
  type ScopedReworkSource,
} from "@/lib/scoped-rework"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type OwnedVersion = {
  id: string
  file_groups: {
    id: string
    primary_photo_id: string
    edit_chain: EditStep[]
    provider: string | null
    jobs: { listing_id: string }
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let input
  try {
    input = validateScopedReworkInput(await req.json())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid batch refinement." },
      { status: 400 }
    )
  }

  // A fresh RLS-scoped listing read is the authorization boundary before the
  // service-role transaction. Client claims never decide ownership or scope.
  const { data: listing } = await supabase.from("listings").select("id").eq("id", listingId).maybeSingle()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  const versionIds = input.targets.map((target) => target.sourceOutputVersionId)
  const { data: versionRows } = await supabase
    .from("output_versions")
    .select("id, file_groups!inner(id, primary_photo_id, edit_chain, provider, jobs!inner(listing_id))")
    .in("id", versionIds)
    .eq("file_groups.jobs.listing_id", listingId)
  const versions = (versionRows ?? []) as unknown as OwnedVersion[]
  if (versions.length !== input.targets.length) {
    return NextResponse.json({ error: "One of the exact source versions is no longer available." }, { status: 409 })
  }

  const photoIds = input.targets.map((target) => target.sourcePhotoId)
  const [{ data: photos }, { data: memberships }] = await Promise.all([
    supabase.from("photos").select("id, room_id").eq("listing_id", listingId).in("id", photoIds),
    supabase
      .from("same_room_group_members")
      .select("photo_id, group_id, same_room_groups!inner(listing_id)")
      .in("photo_id", photoIds)
      .eq("same_room_groups.listing_id", listingId),
  ])
  if ((photos ?? []).length !== photoIds.length) {
    return NextResponse.json({ error: "The displayed photo scope changed. Refresh and review it again." }, { status: 409 })
  }
  const photoById = new Map((photos ?? []).map((photo) => [photo.id, photo]))
  const groupByPhoto = new Map((memberships ?? []).map((member) => [member.photo_id, member.group_id]))
  const versionById = new Map(versions.map((version) => [version.id, version]))

  let snapshot
  try {
    const sources: ScopedReworkSource[] = input.targets.map((target) => {
      const version = versionById.get(target.sourceOutputVersionId)
      const photo = photoById.get(target.sourcePhotoId)
      if (!version || !photo || version.file_groups.primary_photo_id !== target.sourcePhotoId) {
        throw new Error("A selected source version no longer matches its photo.")
      }
      const provider = version.file_groups.provider as ProviderKey | null
      if (!provider || !(provider in MODELS)) throw new Error("A selected result cannot be refined.")
      return {
        sourcePhotoId: target.sourcePhotoId,
        sourceOutputVersionId: target.sourceOutputVersionId,
        sourceFileGroupId: version.file_groups.id,
        roomId: photo.room_id,
        sameRoomGroupId: groupByPhoto.get(photo.id) ?? null,
        editChain: version.file_groups.edit_chain,
        providerCostCents: MODELS[provider].costCents,
      }
    })
    snapshot = buildScopedReworkSnapshot(input, sources)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The target scope could not be confirmed." },
      { status: 409 }
    )
  }

  const requestedTargets = snapshot.targets.map((target) => ({
    sourcePhotoId: target.sourcePhotoId,
    sourceOutputVersionId: target.sourceOutputVersionId,
    protectedGeometry: target.protectedGeometry,
    exception: target.exception,
  }))
  const admin = createAdminClient()
  const { data: created, error } = await admin.rpc("create_scoped_rework_request", {
    p_request_id: input.requestId,
    p_user_id: user.id,
    p_listing_id: listingId,
    p_selection_method: input.selectionMethod,
    p_scope_id: input.scopeId,
    p_instructions: input.instructions,
    p_targets: requestedTargets,
    p_generation_cost_cents: snapshot.initialGenerationCostCents,
  })
  const row = created?.[0]
  if (error || !row) {
    const status = error?.code === "23505" ? 409 : error?.code === "P0002" ? 404 : 500
    return NextResponse.json(
      {
        error: status === 409
          ? "This retry identity belongs to different targets or correction details. Review the scope and try again."
          : "The batch refinement could not be prepared.",
      },
      { status }
    )
  }

  const fileGroupIds = row.scoped_rework_file_group_ids as string[]
  // These calls only enqueue provider work. Generation continues in the
  // existing webhook/reconcile state machines after this response path.
  for (const fileGroupId of fileGroupIds) await submitStep(admin, fileGroupId)

  return NextResponse.json({
    requestId: row.scoped_rework_request_id,
    jobId: row.scoped_rework_job_id,
    fileGroupIds,
    requestedGenerationCount: snapshot.requestedGenerationCount,
    generationCostCents: snapshot.initialGenerationCostCents,
    idempotent: row.was_existing,
  })
}

