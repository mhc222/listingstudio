import { NextResponse, after } from "next/server"
import { claimUploadItemForFinalize, finalizeUploadItem } from "@/lib/intake-finalize"
import { cleanupIntakeObject, getOwnedUploadItem } from "@/lib/intake-lifecycle"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 120

// Phase 57: auth, ownership, and the atomic claim stay on the request path;
// the ~4 s materialize → RPC → cleanup body runs after the response inside
// `after()`, so the client never waits on it. The reconcile cron re-runs any
// row whose deferred body died (see lib/intake-finalize.ts).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const item = await getOwnedUploadItem(supabase, itemId)
  if (!item) return NextResponse.json({ error: "upload item not found" }, { status: 404 })

  const admin = createAdminClient()
  const complete = async () => {
    const { data: latest } = await admin
      .from("upload_items")
      .select("photo_id, intake_path, intake_deleted_at")
      .eq("id", item.id)
      .maybeSingle()
    const cleaned = await cleanupIntakeObject(
      { id: item.id, intake_path: latest?.intake_path ?? item.intake_path, intake_deleted_at: latest?.intake_deleted_at ?? item.intake_deleted_at },
      admin
    )
    return NextResponse.json({
      itemId: item.id,
      photoId: latest?.photo_id ?? item.photo_id,
      status: "complete",
      cleanupPending: !cleaned,
      idempotent: true,
    })
  }

  let claim
  try {
    claim = await claimUploadItemForFinalize(admin, item)
  } catch {
    return NextResponse.json({ error: "could not begin finalization" }, { status: 500 })
  }

  switch (claim) {
    case "canceled":
      return NextResponse.json({ error: "upload item was canceled" }, { status: 409 })
    case "conflict":
      return NextResponse.json({ error: "upload item state changed; retry" }, { status: 409 })
    case "complete":
      return complete()
    case "in-progress":
      return NextResponse.json(
        { itemId: item.id, photoId: item.photo_id, status: "finalizing", idempotent: true },
        { status: 202 }
      )
    case "claimed":
    case "reclaimed":
      after(() =>
        finalizeUploadItem(item.id, user.id, admin).catch((error) =>
          console.error(`deferred finalize ${item.id} crashed`, error)
        )
      )
      return NextResponse.json(
        { itemId: item.id, photoId: item.photo_id, status: "finalizing", reclaimed: claim === "reclaimed" },
        { status: 202 }
      )
  }
}
