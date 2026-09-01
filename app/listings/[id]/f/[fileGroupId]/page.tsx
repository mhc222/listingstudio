import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
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

export default async function FileGroupPage({
  params,
}: {
  params: Promise<{ id: string; fileGroupId: string }>
}) {
  const { id, fileGroupId } = await params
  const supabase = await createClient()

  // RLS scopes file_groups to the owner (via job → listing), so an unowned id
  // returns no row → 404. The listing_id check below is belt-and-suspenders.
  const { data: fg } = await supabase
    .from("file_groups")
    .select(
      `id, primary_photo_id, current_step, step_status, last_error, edit_chain, comment,
       jobs!inner (id, title, kind, listing_id),
       output_versions (id, version_number, parent_version_id, qa_note, storage_path),
       chat_messages (role, content, created_at)`
    )
    .eq("id", fileGroupId)
    .single()

  const job = fg?.jobs as unknown as { id: string; title: string; kind: string; listing_id: string } | null
  if (!fg || !job || job.listing_id !== id) notFound()

  const [{ data: listing }, { data: siblings }] = await Promise.all([
    supabase.from("listings").select("address").eq("id", id).single(),
    supabase
      .from("file_groups")
      .select("id, primary_photo_id, step_status, created_at")
      .eq("job_id", job.id)
      .order("created_at"),
  ])

  const siblingPhotoIds = [...new Set((siblings ?? []).map((item) => item.primary_photo_id))]
  const { data: siblingPhotos } = siblingPhotoIds.length
    ? await supabase
        .from("photos")
        .select("id, storage_path, width")
        .in("id", siblingPhotoIds)
    : { data: [] }
  const siblingPhotoById = new Map((siblingPhotos ?? []).map((photo) => [photo.id, photo]))
  const siblingOriginalUrls = await getUrls(
    "originals",
    (siblingPhotos ?? []).map((photo) => photo.storage_path)
  )
  const primary = siblingPhotoById.get(fg.primary_photo_id)

  const beforeUrls = primary
    ? await getUrls("originals", [primary.storage_path])
    : {}
  const before = {
    url: primary ? beforeUrls[primary.storage_path] ?? null : null,
    width: primary?.width ?? null,
  }

  const outputUrls = await getUrls(
    "outputs",
    fg.output_versions.map((v) => v.storage_path)
  )

  // compliance jsonb (phase 21, migration 0008) fetched separately, fail-open —
  // a nested select would error the whole query on any pre-migration schema gap.
  const complianceById = new Map<string, ComplianceNote>()
  if (fg.output_versions.length > 0) {
    const { data: rows } = await supabase
      .from("output_versions")
      .select("id, compliance")
      .in(
        "id",
        fg.output_versions.map((v) => v.id)
      )
    for (const r of rows ?? [])
      complianceById.set(r.id, (r.compliance as ComplianceNote) ?? null)
  }

  const workspaceFg: WorkspaceFileGroup = {
    id: fg.id,
    primary_photo_id: fg.primary_photo_id,
    current_step: fg.current_step,
    step_status: fg.step_status,
    last_error: fg.last_error,
    comment: fg.comment,
    edit_chain: fg.edit_chain,
    chat_messages: fg.chat_messages ?? [],
    output_versions: fg.output_versions.map((v) => ({
      id: v.id,
      version_number: v.version_number,
      parent_version_id: v.parent_version_id,
      qa_note: v.qa_note,
      compliance: complianceById.get(v.id) ?? null,
      url: outputUrls[v.storage_path] ?? null,
    })),
  }

  const siblingRows = (siblings ?? []).map((item) => {
    const photo = siblingPhotoById.get(item.primary_photo_id)
    return {
      id: item.id,
      step_status: item.step_status,
      url: photo ? siblingOriginalUrls[photo.storage_path] ?? null : null,
    }
  })

  return (
    <main className="min-h-screen bg-background">
      <header className="ls-scroll-edge sticky top-0 z-30 bg-card/82 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <Link
            href={`/listings/${id}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Photos
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.68rem] font-semibold tracking-[0.04em] text-muted-foreground">
              {listing?.address ?? "Listing"}
            </p>
            <h1 className="truncate text-xl font-semibold tracking-[-0.03em] sm:text-2xl">{workspaceTitle(workspaceFg.edit_chain)}</h1>
          </div>
          <Link
            href={`/listings/${id}/activity`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Activity
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        <FileGroupWorkspace
          listingId={id}
          fg={workspaceFg}
          before={before}
          siblings={siblingRows}
        />
      </div>
    </main>
  )
}
