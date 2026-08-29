// Self-check for the phase 19 reel pipeline (no DB, no supabase): builds 4
// synthetic stills + a caption PNG, runs the real buildFfmpegArgs graph
// through ffmpeg in both formats (+music if assets/music has a track), and
// asserts output duration/dimensions with ffprobe-less mp4 parsing via ffmpeg.
// Run: npx tsx scripts/check-reel.ts
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import ffmpegStatic from "ffmpeg-static"
import { buildFfmpegArgs, captionSvg, reelDuration, MUSIC_DIR } from "../lib/reel"

const FFMPEG = process.env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg"

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reel-check-"))
  const colors = ["#3FBFB9", "#D9635F", "#4A6FA5", "#C9A227"]

  for (const [w, h, name] of [[1080, 1920, "9x16"], [1920, 1080, "16x9"]] as const) {
    const stills: string[] = []
    for (let i = 0; i < 4; i++) {
      const p = path.join(tmp, `still-${name}-${i}.jpg`)
      await sharp({
        create: { width: w * 2, height: h * 2, channels: 3, background: colors[i] },
      })
        .jpeg()
        .toFile(p)
      stills.push(p)
    }
    const cap = captionSvg(["123 Smith Street", "3 BD · 2 BA · 1,850 SQFT"], w)
    const capPath = path.join(tmp, `cap-${name}.png`)
    await sharp(Buffer.from(cap.svg)).png().toFile(capPath)

    const tracks = await fs
      .readdir(MUSIC_DIR)
      .then((f) => f.filter((x) => /\.(mp3|m4a|wav)$/i.test(x)))
      .catch(() => [] as string[])
    const musicPath = tracks[0] ? path.join(MUSIC_DIR, tracks[0]) : null

    const outPath = path.join(tmp, `reel-${name}.mp4`)
    const args = buildFfmpegArgs({ stills, capPath, musicPath, w, h, outPath })
    execFileSync(FFMPEG, args, { stdio: "pipe" })

    // probe with ffmpeg -i (stderr carries stream info)
    let info = ""
    try {
      execFileSync(FFMPEG, ["-i", outPath], { stdio: "pipe" })
    } catch (e) {
      info = String((e as { stderr: Buffer }).stderr)
    }
    const expect = reelDuration(4) // 10.5s
    const dur = info.match(/Duration: (\d+):(\d+):([\d.]+)/)
    if (!dur) throw new Error(`no duration parsed for ${name}\n${info}`)
    const seconds = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
    console.assert(Math.abs(seconds - expect) < 0.5, `${name} duration ${seconds}s ≠ ~${expect}s`)
    console.assert(info.includes(`${w}x${h}`), `${name} missing ${w}x${h} in:\n${info}`)
    console.assert(info.includes("h264"), `${name} not h264`)
    if (musicPath) console.assert(info.includes("Audio: aac"), `${name} missing aac audio`)
    const size = (await fs.stat(outPath)).size
    console.log(
      `✓ ${name}: ${seconds.toFixed(2)}s, ${w}x${h}, ${(size / 1024).toFixed(0)}KB, music=${musicPath ? "yes" : "no"}`
    )
  }
  console.log(`stills+outputs in ${tmp} (inspect reel-*.mp4 by eye if curious)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
