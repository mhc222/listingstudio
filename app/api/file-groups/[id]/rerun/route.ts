import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { submitStep } from "@/lib/orchestrator"

// Re-run a failed step (fresh retry budget). Conditional on failed status so
// double-clicks are no-ops.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // RLS-scoped conditional reset proves ownership and gates the rerun
  const { data: reset } = await supabase
    .from("file_groups")
    .update({
      step_status: "queued",
      retry_count: 0,
      fal_request_id: null,
      last_error: null,
    })
    .eq("id", id)
    .eq("step_status", "failed")
    .select("id, job_id")
  if (!reset?.length) return NextResponse.json({ error: "not in failed state" }, { status: 409 })

  await supabase.from("jobs").update({ status: "processing" }).eq("id", reset[0].job_id)
  await submitStep(createAdminClient(), id)
  return NextResponse.json({ ok: true })
}
