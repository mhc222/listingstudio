import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStatus } from "@/lib/imaging"
import {
  completeStep,
  handleGenerationError,
  type FileGroupRow,
} from "@/lib/orchestrator"

// Authenticated, listing-scoped reconciliation for the Activity screen.
// Production normally completes through fal webhooks; localhost cannot receive
// them, so an open Activity page safely polls only the signed-in user's listing.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: listing } = await supabase
    .from("listings")
    .select("id")
    .eq("id", id)
    .maybeSingle()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  const db = createAdminClient()
  const { data: listingJobs } = await db.from("jobs").select("id").eq("listing_id", id)
  const jobIds = (listingJobs ?? []).map((job) => job.id)
  if (jobIds.length === 0) return NextResponse.json({ checked: 0, changed: 0 })

  const { data: running } = await db
    .from("file_groups")
    .select("*")
    .in("job_id", jobIds)
    .eq("step_status", "running")
    .returns<FileGroupRow[]>()

  let changed = 0
  for (const fg of running ?? []) {
    if (!fg.fal_request_id) continue
    const status = await getStatus(fg.provider, fg.fal_request_id)
    if (status === "COMPLETED") {
      await completeStep(db, fg)
      changed += 1
    } else if (status !== "IN_QUEUE" && status !== "IN_PROGRESS") {
      await handleGenerationError(db, fg, `fal status: ${status}`)
      changed += 1
    }
  }

  return NextResponse.json({ checked: running?.length ?? 0, changed })
}
