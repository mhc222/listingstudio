import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import type { ComplianceNote } from "../../job-panel"
import { FileGroupWorkspace, type WorkspaceFileGroup } from "./file-group-workspace"

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

  const [{ data: listing }, { data: primary }] = await Promise.all([
    supabase.from("listings").select("address").eq("id", id).single(),
    supabase
      .from("photos")
      .select("storage_path, width")
      .eq("id", fg.primary_photo_id)
      .maybeSingle(),
  ])

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

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link
        href={`/listings/${id}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← {listing?.address ?? "Listing"}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{job.title}</h1>
      <div className="mt-6">
        <FileGroupWorkspace fg={workspaceFg} before={before} />
      </div>
    </main>
  )
}
