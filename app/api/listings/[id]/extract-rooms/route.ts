import { NextResponse } from "next/server"
import type Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { anthropicClient } from "@/lib/anthropic"
import { FLOOR_PLAN_PARSE_SYSTEM } from "@/lib/prompts"
import { VISION_PARSE_MODEL, visionParseCostCents } from "@/config/models"
import { getUrl } from "@/lib/storage"
import { ROOM_TYPES } from "@/lib/roomTypes"

const VALID_TYPES = new Set<string>(ROOM_TYPES.map((t) => t.value))

// Parse an uploaded floor plan into proposed Room records (Matt, 2026-08-31).
// Vision-only, returns proposals for human review — never writes rooms. Rooms
// are created by the normal createRoom action after the user confirms.
// Ledgered as 'interpreter' (an interpreter-tier Claude call; avoids a DDL
// migration to add a new ledger kind).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { floorPlanId?: string } | null
  if (!body?.floorPlanId) {
    return NextResponse.json({ error: "floorPlanId required" }, { status: 400 })
  }

  // RLS scopes the read to the user's own listing; only floor-plan photos qualify
  const { data: plan } = await supabase
    .from("photos")
    .select("id, storage_path, is_floor_plan")
    .eq("id", body.floorPlanId)
    .eq("listing_id", listingId)
    .single()
  if (!plan || !plan.is_floor_plan) {
    return NextResponse.json({ error: "floor plan not found" }, { status: 404 })
  }

  let planUrl: string
  try {
    planUrl = await getUrl("originals", plan.storage_path, 3600, supabase)
  } catch {
    return NextResponse.json({ error: "could not read the floor plan" }, { status: 500 })
  }

  // PDF plans go in as a document block, images/photos-of-drawings as an image
  // block — Claude reads both. (Matt's plans are often PDFs.)
  const isPdf = plan.storage_path.toLowerCase().endsWith(".pdf")
  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: "Floor plan to transcribe:" },
    isPdf
      ? { type: "document", source: { type: "url", url: planUrl } }
      : { type: "image", source: { type: "url", url: planUrl } },
  ]

  let response: Anthropic.Message
  try {
    response = await anthropicClient().messages.create({
      model: VISION_PARSE_MODEL.id,
      // a busy plan is ~26 rooms × (name + type + 4 dims + x/y); Sonnet ran
      // 3521 tokens here, so leave generous headroom or the JSON truncates
      max_tokens: 8192,
      system: FLOOR_PLAN_PARSE_SYSTEM,
      messages: [{ role: "user", content }],
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "floor plan parse failed" },
      { status: 502 }
    )
  }

  await createAdminClient().from("spend_ledger").insert({
    model: VISION_PARSE_MODEL.id,
    cost_cents: visionParseCostCents(response.usage.input_tokens, response.usage.output_tokens),
    kind: "interpreter",
    edit_type: "FLOOR_PLAN_PARSE",
  })

  let parsed: { units?: unknown; rooms?: unknown }
  try {
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))
  } catch {
    return NextResponse.json({ error: "couldn't read that plan — try a clearer image" }, { status: 502 })
  }

  const units = parsed.units === "m" ? "m" : "ft"
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
  const clamp01 = (v: number | null) => (v == null ? null : Math.min(1, Math.max(0, v)))
  const rooms = (Array.isArray(parsed.rooms) ? parsed.rooms : [])
    .map((r) => {
      const row = r as Record<string, unknown>
      const type = typeof row.room_type === "string" && VALID_TYPES.has(row.room_type)
        ? (row.room_type as string)
        : "other"
      return {
        name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Room",
        room_type: type,
        length_ft: num(row.length_ft),
        length_in: num(row.length_in),
        width_ft: num(row.width_ft),
        width_in: num(row.width_in),
        // normalized label position on the plan (0..1), clamped; null if absent
        x: clamp01(num(row.x)),
        y: clamp01(num(row.y)),
        units,
      }
    })
    // drop rows the model returned with no name AND no dimensions — noise
    .filter(
      (r) =>
        r.name !== "Room" ||
        r.length_ft != null ||
        r.width_ft != null ||
        r.length_in != null ||
        r.width_in != null
    )

  return NextResponse.json({ units, rooms })
}
