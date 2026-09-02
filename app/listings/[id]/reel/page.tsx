import Link from "next/link"
import { notFound } from "next/navigation"
import { promises as fs } from "node:fs"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { MUSIC_DIR } from "@/lib/reel"
import { ToolsNav } from "../tools-nav"
import { ReelPanel, type ReelRecord, type ReelSource } from "./reel-panel"

export default async function ReelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: listing }, { data: photos }, { data: jobs }, { data: reels }] = await Promise.all([
    supabase.from("listings").select("id, address, mls_number").eq("id", id).single(),
    supabase
      .from("photos")
      .select("id, storage_path, is_floor_plan")
      .eq("listing_id", id)
      .order("created_at"),
    supabase
      .from("jobs")
      .select("id, file_groups (id, output_versions (id, version_number, storage_path))")
      .eq("listing_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("reels")
      .select("id, status, format, error, music, clips")
      .eq("listing_id", id)
      .order("created_at", { ascending: false }),
  ])
  if (!listing) notFound()

  const regular = (photos ?? []).filter((p) => !p.is_floor_plan)
  const photoUrls = await getUrls("originals", regular.map((p) => p.storage_path))
  const outputPaths = (jobs ?? []).flatMap((j) =>
    j.file_groups.flatMap((fg) => fg.output_versions.map((v) => v.storage_path))
  )
  const outputUrls = await getUrls("outputs", outputPaths)

  // reel sources: latest output version per file group first, then originals
  const latestOutputs: ReelSource[] = (jobs ?? []).flatMap((j) =>
    j.file_groups.flatMap((fg) => {
      if (fg.output_versions.length === 0) return []
      const latest = [...fg.output_versions].sort((a, b) => b.version_number - a.version_number)[0]
      return [
        {
          key: `output:${latest.id}`,
          kind: "output" as const,
          id: latest.id,
          url: outputUrls[latest.storage_path] ?? null,
          label: "edited",
        },
      ]
    })
  )
  const sources: ReelSource[] = [
    ...latestOutputs,
    ...regular.map((p) => ({
      key: `photo:${p.id}`,
      kind: "photo" as const,
      id: p.id,
      url: photoUrls[p.storage_path] ?? null,
      label: "original",
    })),
  ]
  const reelRecords: ReelRecord[] = (reels ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    format: r.format,
    error: r.error,
    music: r.music,
    clip_count: Array.isArray(r.clips) ? r.clips.length : 0,
  }))
  const musicTracks = await fs
    .readdir(MUSIC_DIR)
    .then((files) => files.filter((f) => /\.(mp3|m4a|wav)$/i.test(f)).sort())
    .catch(() => [] as string[])

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Link href="/listings" className="inline-flex min-h-10 items-center text-sm text-muted-foreground hover:underline">
        ← Listings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{listing.address}</h1>
      {listing.mls_number && (
        <p className="text-sm text-muted-foreground">MLS {listing.mls_number}</p>
      )}
      <div className="mt-6">
        <ToolsNav listingId={id} />
      </div>
      <div className="mt-6">
        <ReelPanel listingId={id} sources={sources} reels={reelRecords} musicTracks={musicTracks} />
      </div>
    </main>
  )
}
