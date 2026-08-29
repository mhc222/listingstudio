import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { createClient } from "@/lib/supabase/server"
import { upload } from "@/lib/storage"

// Markup-to-edit (phase 23): store the flattened annotated copy of a photo.
// Not a photos row — it exists only as a model input, referenced from the
// MARKUP_EDIT step's options.markup_path.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const form = await req.formData()
  const file = form.get("file")
  if (!(file instanceof File))
    return NextResponse.json({ error: "file required" }, { status: 400 })

  // jpeg keeps the saturated mark colors intact (gate experiment) at a
  // fraction of the PNG size
  const buf = await sharp(Buffer.from(await file.arrayBuffer()))
    .jpeg({ quality: 92 })
    .toBuffer()
  const path = `${user.id}/markup/${crypto.randomUUID()}.jpg`
  try {
    await upload("originals", path, buf, "image/jpeg", supabase)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "upload failed" },
      { status: 500 }
    )
  }
  return NextResponse.json({ path })
}
