import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Redirect to a signed download URL for a finished reel.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: reel } = await supabase
    .from("reels")
    .select("id, status, storage_path, format, listings (address)")
    .eq("id", id)
    .single()
  if (!reel || reel.status !== "complete" || !reel.storage_path) {
    return NextResponse.json({ error: "reel not ready" }, { status: 404 })
  }

  const address = (reel.listings as unknown as { address: string } | null)?.address ?? "listing"
  const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
  const filename = `reel-${slug}-${reel.format.replace(":", "x")}.mp4`

  const { data, error } = await supabase.storage
    .from("outputs")
    .createSignedUrl(reel.storage_path, 3600, { download: filename })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.redirect(data.signedUrl)
}
