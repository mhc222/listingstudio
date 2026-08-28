import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { submitStep } from "@/lib/orchestrator"
import { buildRework, type ChatTurn } from "@/lib/interpreter"
import { INTERPRETER_MODEL } from "@/config/models"
import type { EditStep } from "@/lib/prompts"

// Conversational rework (phase 8): reaction -> corrective instructions -> a
// REWORK step appended to the chain -> new OutputVersion branched from the
// chosen version. Conditional on a settled group so double-sends are no-ops.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { message, versionId } = (await req.json()) as { message?: string; versionId?: string }
  const reaction = (message ?? "").trim()
  if (!reaction) return NextResponse.json({ error: "message required" }, { status: 400 })

  // RLS-scoped reads prove ownership
  const { data: fg } = await supabase
    .from("file_groups")
    .select("id, job_id, edit_chain, step_status")
    .eq("id", id)
    .single()
  if (!fg) return NextResponse.json({ error: "file group not found" }, { status: 404 })
  if (!["complete", "failed"].includes(fg.step_status)) {
    return NextResponse.json({ error: "group is still processing" }, { status: 409 })
  }

  const { data: versions } = await supabase
    .from("output_versions")
    .select("id, version_number, storage_path")
    .eq("file_group_id", id)
    .order("version_number", { ascending: false })
  if (!versions?.length) {
    return NextResponse.json({ error: "no output version to rework" }, { status: 409 })
  }
  const source = versionId ? versions.find((v) => v.id === versionId) : versions[0]
  if (!source) return NextResponse.json({ error: "version not found" }, { status: 404 })

  const { data: history } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("file_group_id", id)
    .order("created_at")

  const { instructions, costCents } = await buildRework(
    (history ?? []).filter((m): m is ChatTurn => m.role === "user" || m.role === "assistant"),
    reaction
  )

  const admin = createAdminClient()
  if (costCents > 0) {
    await admin.from("spend_ledger").insert({
      job_id: fg.job_id,
      file_group_id: id,
      model: INTERPRETER_MODEL.label,
      cost_cents: costCents,
      kind: "interpreter",
    })
    await admin.rpc("increment_job_cost", { p_job_id: fg.job_id, p_cents: costCents })
  }

  const chain = fg.edit_chain as EditStep[]
  const reworkStep: EditStep = {
    edit_type: "REWORK",
    options: {
      instructions,
      source_path: source.storage_path,
      parent_version_id: source.id,
    },
  }
  // conditional append: only from a settled state, fresh retry + QA budget
  const { data: appended } = await supabase
    .from("file_groups")
    .update({
      edit_chain: [...chain, reworkStep],
      current_step: chain.length,
      step_status: "queued",
      retry_count: 0,
      qa_retry_count: 0,
      fal_request_id: null,
      last_error: null,
    })
    .eq("id", id)
    .in("step_status", ["complete", "failed"])
    .select("id")
  if (!appended?.length) {
    return NextResponse.json({ error: "group is no longer settled" }, { status: 409 })
  }

  await supabase.from("chat_messages").insert([
    { file_group_id: id, role: "user", content: reaction },
    {
      file_group_id: id,
      role: "assistant",
      content: `Reworking v${source.version_number}: ${instructions}`,
    },
  ])
  await supabase.from("jobs").update({ status: "processing" }).eq("id", fg.job_id)

  await submitStep(admin, id)
  return NextResponse.json({ ok: true, instructions })
}
