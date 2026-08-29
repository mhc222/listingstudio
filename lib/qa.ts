// Auto-QA (phase 8): Claude vision pass comparing the original photo to the
// final output against the request. Server-only; called from the orchestrator
// after the final chain step completes. QA never blocks delivery — an errored
// QA call records a "skipped" note and the version ships.
import type { SupabaseClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { anthropicClient } from "@/lib/anthropic"
import {
  QA_SYSTEM,
  COMPLIANCE_QA_SYSTEM,
  complianceVisionChecks,
  type ComplianceCheck,
  type EditStep,
} from "@/lib/prompts"
import { INTERPRETER_MODEL, interpreterCostCents } from "@/config/models"
import { getUrl } from "@/lib/storage"

export type QaVerdict = {
  pass: boolean
  note: string
  corrective: string | null
  costCents: number
  // MLS compliance checks (phase 21) — null on non-compliance chains and
  // whenever the verdict couldn't be parsed (fail open, flags only).
  checks: ComplianceCheck[] | null
}

function describeRequest(chain: EditStep[], comment: string | null): string {
  const lines = chain.map((s, i) => {
    const opts = Object.entries(s.options ?? {})
      .filter(([, v]) => v !== "" && v !== false && v != null)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")
    return `${i + 1}. ${s.edit_type}${opts ? ` (${opts})` : ""}`
  })
  if (comment?.trim()) lines.push(`Client notes: ${comment.trim()}`)
  return lines.join("\n")
}

export async function runQA(
  db: SupabaseClient,
  fg: { id: string; edit_chain: EditStep[]; comment: string | null; primary_photo_id: string },
  outputPath: string
): Promise<QaVerdict> {
  const skipped = (why: string): QaVerdict => ({
    pass: true,
    note: `QA skipped: ${why}`,
    corrective: null,
    costCents: 0,
    checks: null,
  })

  let originalUrl: string
  let outputUrl: string
  try {
    const { data: photo } = await db
      .from("photos")
      .select("storage_path")
      .eq("id", fg.primary_photo_id)
      .single()
    if (!photo) return skipped("original photo not found")
    originalUrl = await getUrl("originals", photo.storage_path, 3600, db)
    outputUrl = await getUrl("outputs", outputPath, 3600, db)
  } catch (e) {
    return skipped(e instanceof Error ? e.message : "could not sign image URLs")
  }

  // Compliance mode (phase 21): staging/renovation/dusk chains get named
  // per-check verdicts in the SAME call (dusk's two named checks fold in here
  // as compliance checks — they were previously a plain request appendix).
  const wantedChecks = complianceVisionChecks(fg.edit_chain)
  const request =
    describeRequest(fg.edit_chain, fg.comment) +
    (wantedChecks.length
      ? `\nCompliance checks to evaluate:\n${wantedChecks.map((c) => `- id=${c.id}: ${c.label}`).join("\n")}`
      : "")

  let response: Anthropic.Message
  try {
    response = await anthropicClient().messages.create({
      model: INTERPRETER_MODEL.id,
      max_tokens: wantedChecks.length ? 768 : 512,
      system: wantedChecks.length ? COMPLIANCE_QA_SYSTEM : QA_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "ORIGINAL photo:" },
            { type: "image", source: { type: "url", url: originalUrl } },
            { type: "text", text: "EDITED result:" },
            { type: "image", source: { type: "url", url: outputUrl } },
            { type: "text", text: `Edit request:\n${request}` },
          ],
        },
      ],
    })
  } catch (e) {
    return skipped(e instanceof Error ? e.message : "QA call failed")
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
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
      pass?: unknown
      note?: unknown
      corrective_instruction?: unknown
      checks?: unknown
    }
    // Map returned check verdicts back onto OUR ids/labels; a check the model
    // dropped or garbled ships as pass=true "not evaluated" (fail open).
    const returned = Array.isArray(parsed.checks)
      ? (parsed.checks as { id?: unknown; pass?: unknown; note?: unknown }[])
      : []
    const checks: ComplianceCheck[] | null = wantedChecks.length
      ? wantedChecks.map((w) => {
          const r = returned.find((c) => c.id === w.id)
          if (!r || typeof r.pass !== "boolean")
            return { ...w, pass: true, note: "not evaluated" }
          return {
            ...w,
            pass: r.pass,
            note: typeof r.note === "string" && r.note.trim() ? r.note.trim() : undefined,
          }
        })
      : null
    return {
      pass: Boolean(parsed.pass),
      note: typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : "QA ran",
      corrective:
        typeof parsed.corrective_instruction === "string" && parsed.corrective_instruction.trim()
          ? parsed.corrective_instruction.trim()
          : null,
      costCents,
      checks,
    }
  } catch {
    return {
      pass: true,
      note: "QA skipped: unparseable verdict",
      corrective: null,
      costCents,
      checks: null,
    }
  }
}
