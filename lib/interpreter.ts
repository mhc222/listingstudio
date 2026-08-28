// Interpreter loop part 1 (CLAUDE.md): plain English -> validated job spec.
// Invalid model output is rejected and retried once with the error appended.
import Anthropic from "@anthropic-ai/sdk"
import { anthropicClient } from "@/lib/anthropic"
import { INTERPRETER_SYSTEM, REWORK_SYSTEM, type EditStep } from "@/lib/prompts"
import { INTERPRETER_MODEL, interpreterCostCents } from "@/config/models"

export type ChatTurn = { role: "user" | "assistant"; content: string }

export type Chips = {
  edit_type?: string
  room_type?: string
  furniture_style?: string
}

export type IdeaDirection = { label: string; edit_chain: EditStep[] }

export type ParsedIntent =
  | { kind: "job"; edit_chain: EditStep[]; comment: string; defaults_noted: string[] }
  | { kind: "question"; question: string }
  | { kind: "ideas"; directions: IdeaDirection[]; comment: string }

const SKY_STYLES = ["any", "clear_blue", "clouds_blue", "orange_sunrise"]
const ROOM_TYPES = [
  "living_room",
  "kitchen",
  "dining",
  "main_bedroom",
  "bedroom_2",
  "bedroom_3",
  "bedroom_4",
  "bathroom_ensuite",
  "office",
  "outdoor_patio",
  "other",
]
const FURNITURE_STYLES = [
  "modern",
  "contemporary",
  "farmhouse",
  "traditional",
  "urban_industrial",
  "mid_century_modern",
  "hamptons",
  "commercial",
  "scandinavian",
]
const RENOVATION_TIERS = ["light", "mid", "full"]
const LIGHT_PRESETS = ["dusk", "bright_daylight", "golden_hour", "soft_overcast"]

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}
function oneOf(v: unknown, allowed: string[], fallback: string): string {
  return typeof v === "string" && allowed.includes(v) ? v : fallback
}

// Per-type sanitizers: whitelist option keys, coerce enums, drop the rest.
// An unknown edit_type is a validation error (triggers the retry).
const SANITIZERS: Record<string, (o: Record<string, unknown>) => Record<string, unknown>> = {
  ITEM_REMOVAL: (o) => ({ tier: o.tier === 2 || o.tier === "2" ? 2 : 1, items: str(o.items) }),
  IMAGE_ENHANCEMENT: (o) => ({
    sky_replacement: Boolean(o.sky_replacement),
    day_sky_style: oneOf(o.day_sky_style, SKY_STYLES, "any"),
    grass_repair: Boolean(o.grass_repair),
  }),
  TURN_ON_LIGHTS: () => ({}),
  VIRTUAL_STAGING: (o) => ({
    room_type: oneOf(o.room_type, ROOM_TYPES, "other"),
    furniture_style: oneOf(o.furniture_style, FURNITURE_STYLES, "modern"),
    furniture_required: str(o.furniture_required),
  }),
  VIRTUAL_RENOVATION: (o) => ({
    tier: oneOf(o.tier, RENOVATION_TIERS, "mid"),
    changes: str(o.changes),
  }),
  VIRTUAL_LANDSCAPING: (o) => ({ instructions: str(o.instructions) }),
  DAY_TO_DUSK: (o) => ({ preset: oneOf(o.preset, LIGHT_PRESETS, "dusk") }),
  COLOUR_CHANGE: (o) => ({ element: str(o.element), colour: str(o.colour) }),
  SHADOW_REMOVAL: () => ({}),
}

// Throws with a description of what's wrong so the retry message can carry it.
export function validateIntent(raw: unknown): ParsedIntent {
  if (!raw || typeof raw !== "object") throw new Error("output is not a JSON object")
  const obj = raw as Record<string, unknown>
  if (obj.kind === "question") {
    const question = str(obj.question)
    if (!question) throw new Error('kind "question" requires a non-empty question string')
    return { kind: "question", question }
  }
  if (obj.kind === "ideas") {
    if (!Array.isArray(obj.directions) || obj.directions.length !== 4) {
      throw new Error('kind "ideas" requires exactly 4 directions')
    }
    const directions: IdeaDirection[] = obj.directions.map((d, i) => {
      const dir = (d ?? {}) as Record<string, unknown>
      const label = str(dir.label)
      if (!label) throw new Error(`direction ${i + 1} is missing a label`)
      return { label, edit_chain: sanitizeChain(dir.edit_chain) }
    })
    return { kind: "ideas", directions, comment: str(obj.comment) }
  }
  if (obj.kind !== "job") throw new Error('kind must be "job", "question", or "ideas"')
  const defaults = Array.isArray(obj.defaults_noted)
    ? obj.defaults_noted.map(str).filter(Boolean)
    : []
  return {
    kind: "job",
    edit_chain: sanitizeChain(obj.edit_chain),
    comment: str(obj.comment),
    defaults_noted: defaults,
  }
}

function sanitizeChain(raw: unknown): EditStep[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("edit_chain must be a non-empty array")
  }
  return raw.map((step) => {
    const s = (step ?? {}) as Record<string, unknown>
    const editType = str(s.edit_type)
    const sanitize = SANITIZERS[editType]
    if (!sanitize) throw new Error(`unknown edit_type "${editType}" — use only catalog types`)
    return {
      edit_type: editType,
      options: sanitize((s.options ?? {}) as Record<string, unknown>),
    }
  })
}

function extractJson(text: string): unknown {
  // tolerate stray prose/fences around the object
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) throw new Error("no JSON object in output")
  return JSON.parse(text.slice(start, end + 1))
}

// Never throws away spent tokens: on failure the result carries the cost of
// the failed attempts so the caller can still ledger them.
export async function parseIntent(
  conversation: ChatTurn[],
  chips?: Chips
): Promise<{ intent: ParsedIntent | null; error?: string; costCents: number }> {
  const client = anthropicClient()
  const chipLines = [
    chips?.edit_type && `edit type = ${chips.edit_type}`,
    chips?.room_type && `room type = ${chips.room_type}`,
    chips?.furniture_style && `furniture style = ${chips.furniture_style}`,
  ].filter(Boolean)

  const messages: Anthropic.MessageParam[] = conversation.map((m, i) => ({
    role: m.role,
    content:
      i === conversation.length - 1 && m.role === "user" && chipLines.length
        ? `${m.content}\n\nChips selected: ${chipLines.join(", ")}`
        : m.content,
  }))

  let costCents = 0
  let lastError = ""
  // one retry on invalid output (PLAN.md DoD); both calls hit the ledger
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model: INTERPRETER_MODEL.id,
        max_tokens: 1024,
        system: INTERPRETER_SYSTEM,
        messages,
      })
    } catch (e) {
      return {
        intent: null,
        error: e instanceof Error ? e.message : "Claude API call failed",
        costCents,
      }
    }
    costCents += interpreterCostCents(
      response.usage.input_tokens,
      response.usage.output_tokens
    )
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
    try {
      return { intent: validateIntent(extractJson(text)), costCents }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      messages.push(
        { role: "assistant", content: text },
        {
          role: "user",
          content: `That output was invalid: ${lastError}. Respond again with ONLY a valid JSON object matching the required shapes.`,
        }
      )
    }
  }
  return { intent: null, error: `interpreter produced invalid output twice: ${lastError}`, costCents }
}

// Rework (phase 8): reaction + conversation -> explicit corrective
// instructions for the REWORK template. Falls back to the raw reaction when
// the model output is unusable — a rework should never hard-fail on parsing.
export async function buildRework(
  conversation: ChatTurn[],
  reaction: string
): Promise<{ instructions: string; costCents: number }> {
  const client = anthropicClient()
  const transcript = conversation
    .map((m) => `${m.role === "user" ? "Client" : "Studio"}: ${m.content}`)
    .join("\n")
  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: INTERPRETER_MODEL.id,
      max_tokens: 512,
      system: REWORK_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Conversation so far:\n${transcript || "(none)"}\n\nNew reaction: ${reaction}`,
        },
      ],
    })
  } catch {
    return { instructions: reaction.trim(), costCents: 0 }
  }
  const costCents = interpreterCostCents(
    response.usage.input_tokens,
    response.usage.output_tokens
  )
  try {
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))
    return { instructions: str(parsed.instructions) || reaction.trim(), costCents }
  } catch {
    return { instructions: reaction.trim(), costCents }
  }
}
