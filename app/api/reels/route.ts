import { NextRequest, NextResponse, after } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { MUSIC_DIR, renderReel, type ReelClip } from "@/lib/reel"

export const maxDuration = 300

type ClipInput = { kind: "photo" | "output"; id: string }

// Tier A reel: queue a render row, kick the ffmpeg render after the response.
// Pure code — no ledger row (HDR_MERGE precedent). The reconcile cron rescues
// rows whose after() kick died.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  const listingId: string | undefined = body?.listingId
  const clipInputs: ClipInput[] = Array.isArray(body?.clips) ? body.clips : []
  const format: string = body?.format === "16:9" ? "16:9" : "9:16"
  const music: string | null = typeof body?.music === "string" && body.music ? body.music : null

  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 })
  if (clipInputs.length < 2 || clipInputs.length > 20) {
    return NextResponse.json({ error: "Pick 2-20 photos for a reel" }, { status: 400 })
  }

  // RLS-scoped reads prove ownership of the listing and every source
  const { data: listing } = await supabase
    .from("listings")
    .select("id, address")
    .eq("id", listingId)
    .single()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  const photoIds = clipInputs.filter((c) => c.kind === "photo").map((c) => c.id)
  const outputIds = clipInputs.filter((c) => c.kind === "output").map((c) => c.id)

  const [{ data: photos }, { data: outputs }] = await Promise.all([
    photoIds.length
      ? supabase
          .from("photos")
          .select("id, storage_path")
          .eq("listing_id", listingId)
          .in("id", photoIds)
      : Promise.resolve({ data: [] as { id: string; storage_path: string }[] }),
    outputIds.length
      ? supabase
          .from("output_versions")
          .select("id, storage_path, file_groups!inner(jobs!inner(listing_id))")
          .eq("file_groups.jobs.listing_id", listingId)
          .in("id", outputIds)
      : Promise.resolve({ data: [] as { id: string; storage_path: string }[] }),
  ])

  const pathById = new Map<string, ReelClip>()
  for (const p of photos ?? []) pathById.set(p.id, { bucket: "originals", path: p.storage_path })
  for (const o of outputs ?? []) pathById.set(o.id, { bucket: "outputs", path: o.storage_path })

  const clips: ReelClip[] = []
  for (const c of clipInputs) {
    const resolved = pathById.get(c.id)
    if (!resolved) {
      return NextResponse.json({ error: "a selected photo does not belong to this listing" }, { status: 400 })
    }
    clips.push(resolved)
  }

  if (music) {
    const safe = path.basename(music)
    const ok = await fs.access(path.join(MUSIC_DIR, safe)).then(() => true, () => false)
    if (!ok) return NextResponse.json({ error: "music track not found" }, { status: 400 })
  }

  // caption: address + facts line from listing copy when copywriting has run
  const { data: copyRow } = await supabase
    .from("listing_copy")
    .select("facts")
    .eq("listing_id", listingId)
    .not("facts", "eq", "{}")
    .limit(1)
    .maybeSingle()
  const facts = (copyRow?.facts ?? {}) as { beds?: number; baths?: number; sqft?: number }
  const factsParts = [
    facts.beds ? `${facts.beds} BD` : null,
    facts.baths ? `${facts.baths} BA` : null,
    facts.sqft ? `${Number(facts.sqft).toLocaleString("en-US")} SQFT` : null,
  ].filter(Boolean)
  const caption = factsParts.length
    ? [listing.address, factsParts.join(" · ")]
    : [listing.address]

  const { data: reel, error } = await supabase
    .from("reels")
    .insert({
      listing_id: listingId,
      format,
      clips,
      music: music ? path.basename(music) : null,
      caption,
    })
    .select("id")
    .single()
  if (error || !reel) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 })
  }

  // render post-response with the admin client (no cookies in after())
  after(() => renderReel(createAdminClient(), reel.id))

  return NextResponse.json({ id: reel.id })
}
