import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parseIntent, type ChatTurn, type Chips } from "@/lib/interpreter"
import { INTERPRETER_MODEL } from "@/config/models"

// Parse a chat conversation (+ chips) into a job spec or one clarifying
// question. Every interpreter call is logged to the ledger (kind=interpreter);
// job_id stays null because the job doesn't exist yet at parse time.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json()
  const { messages, chips } = body as { messages: ChatTurn[]; chips?: Chips }
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 })
  }

  const { intent, error, costCents } = await parseIntent(messages, chips)
  if (costCents > 0) {
    // failed attempts spent tokens too — always counted, never double-counted
    await createAdminClient().from("spend_ledger").insert({
      model: INTERPRETER_MODEL.id,
      cost_cents: costCents,
      kind: "interpreter",
    })
  }
  if (!intent) {
    return NextResponse.json({ error: error ?? "interpreter failed" }, { status: 502 })
  }
  return NextResponse.json(intent)
}
