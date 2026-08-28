import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 30

const FAIL_MSG = "couldn't read that page — screenshot it and upload instead"

// Obvious non-content images; real size filtering happens at import time
// (sharp checks actual dimensions before anything enters the library).
const SKIP = /\.svg|\.gif|logo|sprite|icon|favicon|avatar|pixel|badge|^data:/i

// Inspiration by URL (phase 9): fetch ONE user-pasted URL, surface og:image +
// prominent <img> tags as candidates for the picker strip. Never scrape
// beyond the single URL (CLAUDE.md).
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { url } = (await req.json()) as { url?: string }
  let base: URL
  try {
    base = new URL(url ?? "")
    if (!["http:", "https:"].includes(base.protocol)) throw new Error("bad protocol")
  } catch {
    return NextResponse.json({ error: "a full http(s) URL is required" }, { status: 400 })
  }

  let html: string
  try {
    const res = await fetch(base, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ListingStudio/1.0)" },
    })
    if (!res.ok) throw new Error(String(res.status))
    html = (await res.text()).slice(0, 2_000_000)
  } catch {
    return NextResponse.json({ error: FAIL_MSG }, { status: 422 })
  }

  const candidates: string[] = []
  const push = (raw: string | undefined) => {
    if (!raw) return
    try {
      const abs = new URL(raw, base).toString()
      if (!SKIP.test(abs) && !candidates.includes(abs)) candidates.push(abs)
    } catch {
      /* unresolvable src — skip */
    }
  }

  // og:image first (either attribute order)
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/gi
  )) {
    push(/content=["']([^"']+)["']/i.exec(m[0])?.[1])
  }
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    push(/src=["']([^"']+)["']/i.exec(m[0])?.[1])
    if (candidates.length >= 24) break
  }

  if (!candidates.length) {
    return NextResponse.json({ error: FAIL_MSG }, { status: 422 })
  }
  return NextResponse.json({ images: candidates.slice(0, 12) })
}
