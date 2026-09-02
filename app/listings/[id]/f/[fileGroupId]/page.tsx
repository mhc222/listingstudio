import Link from "next/link"
import { notFound } from "next/navigation"
import { MODELS, type ProviderKey } from "@/config/models"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getUrls } from "@/lib/storage"
import type { ComplianceNote } from "../../job-feed"
import { EDIT_TYPES } from "../../edit-types"
import { FileGroupWorkspace, type WorkspaceFileGroup } from "./file-group-workspace"

function workspaceTitle(chain: { edit_type: string }[]): string {
  const labels = chain
    .filter((step) => step.edit_type !== "REWORK")
    .map((step) => EDIT_TYPES[step.edit_type]?.label ?? step.edit_type.replaceAll("_", " "))
  return labels.join(" → ") || "Photo edit"
}

type LineageGroup = {
  id: string
  primary_photo_id: string
  step_status: string
  last_error: string | null
  edit_chain: { edit_type: string; options?: Record<string, unknown> }[]
  comment: string | null
  provider: ProviderKey | null
  variation_index: number | null
  jobs: { id: string; title: string; kind: string; listing_id: string }
  output_versions: Array<{
    id: string
    version_number: number
    version_label: string | null
    parent_version_id: string | null
    qa_note: string | null
    storage_path: string
    created_at: string
  }>
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

export default async function FileGroupPage({ params, searchParams }: {
  params: Promise<{ id: string; fileGroupId: string }>
  searchParams: Promise<{ version?: string }>
}) {
  const { id, fileGroupId } = await params
  const query = await searchParams
  const supabase = await createClient()

  const { data: currentRaw } = await supabase
    .from("file_groups")
    .select(
      `id, primary_photo_id, current_step, step_status, last_error, edit_chain, comment,
       jobs!inner (id, title, kind, listing_id),
       chat_messages (role, content, created_at)`
    )
    .eq("id", fileGroupId)
    .single()
  const currentJob = one(currentRaw?.jobs ?? null) as { id: string; title: string; kind: string; listing_id: string } | null
  if (!currentRaw || !currentJob || currentJob.listing_id !== id) notFound()

  const [{ data: listing }, { data: siblings }, { data: lineageRaw }] = await Promise.all([
    supabase.from("listings").select("address").eq("id", id).single(),
    supabase.from("file_groups").select("id, primary_photo_id, step_status, created_at").eq("job_id", currentJob.id).order("created_at"),
    supabase
      .from("file_groups")
      .select(
        `id, primary_photo_id, step_status, last_error, edit_chain, comment, provider, variation_index,
         jobs!inner (id, title, kind, listing_id),
         output_versions (id, version_number, version_label, parent_version_id, qa_note, storage_path, created_at)`
      )
      .eq("primary_photo_id", currentRaw.primary_photo_id)
      .eq("jobs.listing_id", id),
  ])
  const lineageGroups = (lineageRaw ?? []).map((group) => ({
    ...group,
    jobs: one(group.jobs)!,
  })) as unknown as LineageGroup[]

  const siblingPhotoIds = [...new Set((siblings ?? []).map((item) => item.primary_photo_id))]
  const { data: siblingPhotos } = siblingPhotoIds.length
    ? await supabase.from("photos").select("id, storage_path, width").in("id", siblingPhotoIds)
    : { data: [] }
  const siblingPhotoById = new Map((siblingPhotos ?? []).map((photo) => [photo.id, photo]))
  const storageClient = createAdminClient()
  const siblingOriginalUrls = await getUrls("originals", (siblingPhotos ?? []).map((photo) => photo.storage_path), 3600, storageClient)
  const primary = siblingPhotoById.get(currentRaw.primary_photo_id)
  const beforeUrls = primary ? await getUrls("originals", [primary.storage_path], 3600, storageClient) : {}
  const before = { url: primary ? beforeUrls[primary.storage_path] ?? null : null, width: primary?.width ?? null }

  const lineageVersions = lineageGroups.flatMap((group) => group.output_versions.map((version) => ({ group, version })))
  const outputUrls = await getUrls("outputs", lineageVersions.map(({ version }) => version.storage_path), 3600, storageClient)
  const complianceById = new Map<string, ComplianceNote>()
  const reviewById = new Map<string, {
    review_state: "unreviewed" | "needs_changes" | "approved"
    review_note: string | null
    reviewed_at: string | null
  }>()
  if (lineageVersions.length > 0) {
    const { data: rows } = await supabase
      .from("output_versions")
      .select("id, compliance, review_state, review_note, reviewed_at")
      .in("id", lineageVersions.map(({ version }) => version.id))
    for (const row of rows ?? []) {
      complianceById.set(row.id, (row.compliance as ComplianceNote) ?? null)
      reviewById.set(row.id, {
        review_state: row.review_state as "unreviewed" | "needs_changes" | "approved",
        review_note: row.review_note,
        reviewed_at: row.reviewed_at,
      })
    }
  }

  const { data: selectedFinal } = await supabase
    .from("photo_finals")
    .select("id, output_version_id, selected_at")
    .eq("listing_id", id)
    .eq("source_photo_id", currentRaw.primary_photo_id)
    .maybeSingle()

  const workspaceFg: WorkspaceFileGroup = {
    id: currentRaw.id,
    primary_photo_id: currentRaw.primary_photo_id,
    current_step: currentRaw.current_step,
    step_status: currentRaw.step_status,
    last_error: currentRaw.last_error,
    comment: currentRaw.comment,
    edit_chain: currentRaw.edit_chain,
    chat_messages: currentRaw.chat_messages ?? [],
    output_versions: lineageVersions.map(({ group, version }) => ({
      id: version.id,
      file_group_id: group.id,
      job_title: group.jobs.title,
      version_number: version.version_number,
      version_label: version.version_label,
      parent_version_id: version.parent_version_id,
      variation_index: group.variation_index,
      created_at: version.created_at,
      group_status: group.step_status,
      group_error: group.last_error,
      edit_chain: group.edit_chain,
      generation_cost_cents: group.provider ? MODELS[group.provider].costCents : 0,
      qa_note: version.qa_note,
      compliance: complianceById.get(version.id) ?? null,
      review_state: reviewById.get(version.id)?.review_state ?? "unreviewed",
      review_note: reviewById.get(version.id)?.review_note ?? null,
      reviewed_at: reviewById.get(version.id)?.reviewed_at ?? null,
      url: outputUrls[version.storage_path] ?? null,
    })),
    final: selectedFinal ? {
      id: selectedFinal.id,
      output_version_id: selectedFinal.output_version_id,
      selected_at: selectedFinal.selected_at,
    } : null,
  }

  const siblingRows = (siblings ?? []).map((item) => {
    const photo = siblingPhotoById.get(item.primary_photo_id)
    return { id: item.id, step_status: item.step_status, url: photo ? siblingOriginalUrls[photo.storage_path] ?? null : null }
  })

  return (
    <main className="min-h-screen bg-background">
      <header className="ls-scroll-edge sticky top-0 z-30 bg-card/82 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <Link href={`/listings/${id}`} className="inline-flex min-h-10 items-center text-sm text-muted-foreground underline-offset-4 hover:underline">← Photos</Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.68rem] font-semibold tracking-[0.04em] text-muted-foreground">{listing?.address ?? "Listing"}</p>
            <h1 className="truncate text-xl font-semibold tracking-[-0.03em] sm:text-2xl">{workspaceTitle(workspaceFg.edit_chain)}</h1>
          </div>
          <Link href={`/listings/${id}/activity`} className="inline-flex min-h-10 items-center text-sm text-muted-foreground underline-offset-4 hover:underline">Activity</Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        <FileGroupWorkspace listingId={id} fg={workspaceFg} before={before} siblings={siblingRows} initialVersionId={query.version} />
      </div>
    </main>
  )
}
