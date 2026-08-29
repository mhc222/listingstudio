// Phase 19 Tier A: Ken Burns reel renderer — pure code (ffmpeg), no AI call,
// no ledger row (HDR_MERGE precedent). Never runs in a request handler: POST
// /api/reels queues + kicks it via next/server after(); the reconcile cron
// rescues queued/stuck rows. Every state transition is a conditional update,
// so duplicate render attempts are no-ops.
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import sharp from "sharp"
import ffmpegStatic from "ffmpeg-static"
import type { SupabaseClient } from "@supabase/supabase-js"
import { download, upload } from "@/lib/storage"

const execFileAsync = promisify(execFile)

export const MUSIC_DIR = path.join(process.cwd(), "assets", "music")

export type ReelClip = { bucket: "originals" | "outputs"; path: string }
export type ReelRow = {
  id: string
  listing_id: string
  status: string
  format: "9:16" | "16:9"
  clips: ReelClip[]
  music: string | null
  caption: string[]
  started_at: string | null
}

const FPS = 30
const CLIP_SECONDS = 3
const FADE_SECONDS = 0.5
const FRAMES = CLIP_SECONDS * FPS

export function reelDuration(clipCount: number) {
  return CLIP_SECONDS * clipCount - FADE_SECONDS * (clipCount - 1)
}

function ffmpegBin() {
  // ffmpeg-static ships the binary for Vercel; FFMPEG_PATH overrides, PATH is last resort
  return process.env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg"
}

// Four alternating Ken Burns moves over a 2x-supersampled still (supersampling
// hides zoompan's integer-pixel jitter).
function kenBurns(i: number, w: number, h: number) {
  const last = FRAMES - 1
  const presets = [
    { z: `1+0.15*on/${last}`, x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" }, // push in
    { z: `1.15-0.15*on/${last}`, x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" }, // pull back
    { z: "1.1", x: `(iw-iw/zoom)*on/${last}`, y: "(ih-ih/zoom)/2" }, // pan right
    { z: "1.1", x: `(iw-iw/zoom)*(1-on/${last})`, y: "(ih-ih/zoom)/2" }, // pan left
  ]
  const p = presets[i % presets.length]
  return `zoompan=z='${p.z}':x='${p.x}':y='${p.y}':d=${FRAMES}:s=${w}x${h}:fps=${FPS},settb=AVTB`
}

function captionSvg(lines: string[], w: number) {
  const pad = Math.round(w * 0.045)
  const addressSize = Math.round(w * 0.037)
  const factsSize = Math.round(w * 0.024)
  const hasFacts = lines.length > 1 && lines[1]
  const height = pad * 2 + addressSize + (hasFacts ? factsSize + Math.round(pad * 0.4) : 0)
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return {
    height,
    svg: `<svg width="${w}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${height}" fill="black" fill-opacity="0.62"/>
  <text x="${pad}" y="${pad + addressSize}" font-family="monospace" font-size="${addressSize}" font-weight="bold" fill="white" letter-spacing="1">${esc(lines[0] ?? "")}</text>
  ${hasFacts ? `<text x="${pad}" y="${height - pad}" font-family="monospace" font-size="${factsSize}" fill="#3FBFB9" letter-spacing="2">${esc(lines[1])}</text>` : ""}
</svg>`,
  }
}

async function claim(db: SupabaseClient, reelId: string) {
  const { data } = await db
    .from("reels")
    .update({ status: "rendering", started_at: new Date().toISOString(), error: null })
    .eq("id", reelId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle()
  return data as ReelRow | null
}

export async function renderReel(db: SupabaseClient, reelId: string) {
  const reel = await claim(db, reelId)
  if (!reel) return // already claimed / done — duplicate kicks are no-ops

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reel-"))
  try {
    const [w, h] = reel.format === "9:16" ? [1080, 1920] : [1920, 1080]

    // 1. download + normalize each source to a 2x cover-cropped jpeg
    const stills: string[] = []
    for (let i = 0; i < reel.clips.length; i++) {
      const clip = reel.clips[i]
      const blob = await download(clip.bucket, clip.path, db)
      const out = path.join(tmp, `still-${i}.jpg`)
      await sharp(Buffer.from(await blob.arrayBuffer()))
        .rotate()
        .resize(w * 2, h * 2, { fit: "cover" })
        .jpeg({ quality: 92 })
        .toFile(out)
      stills.push(out)
    }

    // 2. caption overlay png
    const cap = captionSvg(reel.caption, w)
    const capPath = path.join(tmp, "caption.png")
    await sharp(Buffer.from(cap.svg)).png().toFile(capPath)

    // 3. filtergraph: per-still Ken Burns → xfade chain → caption overlay
    const filters: string[] = []
    stills.forEach((_, i) => filters.push(`[${i}:v]${kenBurns(i, w, h)}[v${i}]`))
    let vout = "[v0]"
    for (let i = 1; i < stills.length; i++) {
      const offset = (CLIP_SECONDS - FADE_SECONDS) * i
      const label = `[x${i}]`
      filters.push(
        `${vout}[v${i}]xfade=transition=fade:duration=${FADE_SECONDS}:offset=${offset}${label}`
      )
      vout = label
    }
    const capIndex = stills.length
    filters.push(
      `${vout}[${capIndex}:v]overlay=0:main_h-overlay_h-${Math.round(h * 0.05)},format=yuv420p[vfinal]`
    )

    const total = reelDuration(stills.length)
    const args: string[] = []
    stills.forEach((s) => args.push("-i", s))
    args.push("-i", capPath)

    const musicIndex = capIndex + 1
    if (reel.music) {
      args.push("-stream_loop", "-1", "-i", path.join(MUSIC_DIR, path.basename(reel.music)))
      filters.push(
        `[${musicIndex}:a]afade=t=out:st=${Math.max(0, total - 1.5)}:d=1.5[afinal]`
      )
    }

    args.push("-filter_complex", filters.join(";"), "-map", "[vfinal]")
    if (reel.music) args.push("-map", "[afinal]", "-c:a", "aac", "-b:a", "128k")
    const outPath = path.join(tmp, "reel.mp4")
    args.push(
      "-t", String(total),
      "-r", String(FPS),
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "21",
      "-movflags", "+faststart",
      "-y", outPath
    )

    await execFileAsync(ffmpegBin(), args, { maxBuffer: 32 * 1024 * 1024 })

    // 4. upload + complete (conditional — only the claiming render completes)
    const { data: listing } = await db
      .from("listings")
      .select("user_id")
      .eq("id", reel.listing_id)
      .single()
    const storagePath = `${listing!.user_id}/reels/${reel.id}.mp4`
    await upload("outputs", storagePath, await fs.readFile(outPath), "video/mp4", db)
    await db
      .from("reels")
      .update({ status: "complete", storage_path: storagePath })
      .eq("id", reelId)
      .eq("status", "rendering")
  } catch (e) {
    await db
      .from("reels")
      .update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "render failed" })
      .eq("id", reelId)
      .eq("status", "rendering")
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
