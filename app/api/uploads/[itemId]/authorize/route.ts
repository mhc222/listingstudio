import { NextResponse } from "next/server"
import { getOwnedUploadItem } from "@/lib/intake-lifecycle"
import { createClient } from "@/lib/supabase/server"

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
  if (!["reserved", "failed"].includes(item.status)) {
    return NextResponse.json(
      { error: `a ${item.status} upload cannot be reauthorized` },
      { status: 409 }
    )
  }

  const { data, error } = await supabase.storage
    .from("intake")
    .createSignedUploadUrl(item.intake_path)
  if (error) {
    return NextResponse.json({ error: "could not authorize direct upload" }, { status: 500 })
  }

  return NextResponse.json({
    itemId: item.id,
    intakePath: item.intake_path,
    token: data.token,
    expiresInSeconds: 7200,
  })
}

