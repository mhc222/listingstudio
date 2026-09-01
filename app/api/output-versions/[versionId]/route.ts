import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeVersionLabel } from "@/lib/versioning"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: owned } = await supabase
    .from("output_versions")
    .select("id")
    .eq("id", versionId)
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: "version not found" }, { status: 404 })

  let versionLabel: string | null
  try {
    const body = await req.json()
    versionLabel = normalizeVersionLabel(body?.label, true)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid version name." },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("output_versions")
    .update({ version_label: versionLabel })
    .eq("id", versionId)
    .select("id, version_label")
    .single()
  if (error || !data) {
    return NextResponse.json({ error: "The version name could not be saved." }, { status: 500 })
  }
  return NextResponse.json({ id: data.id, label: data.version_label })
}
