import { NextResponse } from "next/server"
import { MODELS, type ProviderKey } from "@/config/models"
import { submitStep } from "@/lib/orchestrator"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { validateVariationInput, variationGenerationCostCents } from "@/lib/versioning"

type OwnedSource = {
  id: string
  file_groups: {
    provider: string | null
    jobs: { listing_id: string }
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let input
  try {
    input = validateVariationInput(await req.json())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid variation request." },
      { status: 400 }
    )
  }

  const { data } = await supabase
    .from("output_versions")
    .select("id, file_groups!inner(provider, jobs!inner(listing_id))")
    .eq("id", versionId)
    .maybeSingle()
  const source = data as unknown as OwnedSource | null
  if (!source) return NextResponse.json({ error: "source version not found" }, { status: 404 })
  const provider = source.file_groups.provider as ProviderKey | null
  if (!provider || !(provider in MODELS)) {
    return NextResponse.json({ error: "This version cannot create variations." }, { status: 409 })
  }
  const generationCostCents = variationGenerationCostCents(MODELS[provider].costCents, input.count)

  const admin = createAdminClient()
  const { data: created, error } = await admin.rpc("create_variation_request", {
    p_request_id: input.requestId,
    p_user_id: user.id,
    p_source_output_version_id: versionId,
    p_instructions: input.instructions,
    p_labels: input.labels,
    p_generation_cost_cents: generationCostCents,
  })
  const row = created?.[0]
  if (error || !row) {
    const status = error?.code === "23505" ? 409 : error?.code === "P0002" ? 404 : 500
    return NextResponse.json(
      { error: status === 409 ? "This retry identity belongs to different variation details." : "The variations could not be prepared." },
      { status }
    )
  }

  const fileGroupIds = row.variation_file_group_ids as string[]
  for (const fileGroupId of fileGroupIds) await submitStep(admin, fileGroupId)

  return NextResponse.json({
    jobId: row.variation_job_id,
    fileGroupIds,
    requestedGenerationCount: input.count,
    generationCostCents,
    idempotent: row.was_existing,
  })
}
