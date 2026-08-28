import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickProvider } from "@/config/models"
import { submitStep } from "@/lib/orchestrator"
import type { EditStep } from "@/lib/prompts"

// Create a job + one file group and submit its first step. Never awaits
// generation — fal queue + webhook/reconcile advance the state machine.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json()
  const { listingId, photoId, editChain, comment, sizePreset } = body as {
    listingId: string
    photoId: string
    editChain: EditStep[]
    comment?: string
    sizePreset?: string
  }
  if (!listingId || !photoId || !editChain?.length) {
    return NextResponse.json({ error: "listingId, photoId, editChain required" }, { status: 400 })
  }

  // RLS-scoped read proves ownership of the photo/listing
  const { data: photo } = await supabase
    .from("photos")
    .select("id, listing_id")
    .eq("id", photoId)
    .eq("listing_id", listingId)
    .single()
  if (!photo) return NextResponse.json({ error: "photo not found" }, { status: 404 })

  const title =
    editChain
      .map((s) => s.edit_type.replaceAll("_", " ").toLowerCase())
      .join(" → ") + (comment ? ` — ${comment.slice(0, 60)}` : "")

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      listing_id: listingId,
      title,
      status: "processing",
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (jobError || !job) {
    return NextResponse.json({ error: jobError?.message ?? "job insert failed" }, { status: 500 })
  }

  const { data: fg, error: fgError } = await supabase
    .from("file_groups")
    .insert({
      job_id: job.id,
      primary_photo_id: photoId,
      edit_chain: editChain,
      comment: comment ?? null,
      size_preset: ["original", "under_10mb", "under_5mb"].includes(sizePreset ?? "")
        ? sizePreset
        : "original",
      provider: pickProvider(editChain.length),
    })
    .select("id")
    .single()
  if (fgError || !fg) {
    return NextResponse.json({ error: fgError?.message ?? "file group insert failed" }, { status: 500 })
  }

  // submission runs with the admin client (also used by webhook/cron paths)
  await submitStep(createAdminClient(), fg.id)

  return NextResponse.json({ jobId: job.id, fileGroupId: fg.id })
}
