import { NextResponse } from "next/server"
import type Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { anthropicClient } from "@/lib/anthropic"
import { COPYWRITING_SYSTEM, COPY_TONES } from "@/lib/prompts"
import { INTERPRETER_MODEL, interpreterCostCents } from "@/config/models"
import { getUrl } from "@/lib/storage"

export type CopyFacts = { beds: string; baths: string; sqft: string; features: string }

const MAX_PHOTOS = 8

// Generate listing copy: photos + facts + tone -> headline/100w/250w, upserted
// per (listing, tone). Every call hits the ledger (kind=copywriting).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: listing } = await supabase
    .from("listings")
    .select("id, address")
    .eq("id", listingId)
    .single()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  const body = (await req.json()) as { photoIds?: string[]; facts?: CopyFacts; tone?: string }
  const tone = body.tone ?? ""
  if (!COPY_TONES[tone]) return NextResponse.json({ error: "invalid tone" }, { status: 400 })
  const photoIds = (body.photoIds ?? []).slice(0, MAX_PHOTOS)
  if (photoIds.length === 0) {
    return NextResponse.json({ error: "select at least one photo" }, { status: 400 })
  }
  const facts: CopyFacts = {
    beds: body.facts?.beds?.trim() ?? "",
    baths: body.facts?.baths?.trim() ?? "",
    sqft: body.facts?.sqft?.trim() ?? "",
    features: body.facts?.features?.trim() ?? "",
  }

  // RLS scopes the read; anything not owned simply doesn't come back
  const { data: photos } = await supabase
    .from("photos")
    .select("id, storage_path")
    .eq("listing_id", listingId)
    .in("id", photoIds)
  if (!photos?.length) return NextResponse.json({ error: "photos not found" }, { status: 400 })

  const urls = await Promise.all(
    photos.map((p) => getUrl("originals", p.storage_path, 3600, supabase))
  )

  const factLines = [
    facts.beds && `Bedrooms: ${facts.beds}`,
    facts.baths && `Bathrooms: ${facts.baths}`,
    facts.sqft && `Square footage: ${facts.sqft}`,
    facts.features && `Notable features: ${facts.features}`,
  ]
    .filter(Boolean)
    .join("\n")

  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `Listing photos (${urls.length}):` },
    ...urls.map(
      (url): Anthropic.ContentBlockParam => ({ type: "image", source: { type: "url", url } })
    ),
    {
      type: "text",
      text: `Property facts:\n${factLines || "(none provided — write from the photos alone)"}\n\nTone: ${COPY_TONES[tone].label} — ${COPY_TONES[tone].voice}`,
    },
  ]

  let response: Anthropic.Message
  try {
    response = await anthropicClient().messages.create({
      model: INTERPRETER_MODEL.id,
      max_tokens: 1024,
      system: COPYWRITING_SYSTEM,
      messages: [{ role: "user", content }],
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "copywriting call failed" },
      { status: 502 }
    )
  }

  const costCents = interpreterCostCents(
    response.usage.input_tokens,
    response.usage.output_tokens
  )
  await createAdminClient().from("spend_ledger").insert({
    model: INTERPRETER_MODEL.id,
    cost_cents: costCents,
    kind: "copywriting",
    edit_type: "COPYWRITING",
  })

  let parsed: { headline?: unknown; desc_100?: unknown; desc_250?: unknown }
  try {
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))
  } catch {
    return NextResponse.json({ error: "unparseable copy response" }, { status: 502 })
  }
  const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : ""
  const desc_100 = typeof parsed.desc_100 === "string" ? parsed.desc_100.trim() : ""
  const desc_250 = typeof parsed.desc_250 === "string" ? parsed.desc_250.trim() : ""
  if (!headline || !desc_100 || !desc_250) {
    return NextResponse.json({ error: "incomplete copy response" }, { status: 502 })
  }

  const { data: row, error } = await supabase
    .from("listing_copy")
    .upsert(
      {
        listing_id: listingId,
        tone,
        facts,
        headline,
        desc_100,
        desc_250,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "listing_id,tone" }
    )
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(row)
}

// Persist in-app edits to a tone's copy.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json()) as {
    tone?: string
    headline?: string
    desc_100?: string
    desc_250?: string
  }
  if (!COPY_TONES[body.tone ?? ""]) {
    return NextResponse.json({ error: "invalid tone" }, { status: 400 })
  }

  const { data: row, error } = await supabase
    .from("listing_copy")
    .update({
      headline: body.headline ?? "",
      desc_100: body.desc_100 ?? "",
      desc_250: body.desc_250 ?? "",
      updated_at: new Date().toISOString(),
    })
    .eq("listing_id", listingId)
    .eq("tone", body.tone)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(row)
}
