import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { TERMS_VERSION } from "@/config/terms"

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // RLS (with check auth.uid() = user_id) scopes the insert; duplicate
  // acceptances of the same version are no-ops.
  const { error } = await supabase
    .from("terms_acceptances")
    .upsert(
      { user_id: user.id, version: TERMS_VERSION },
      { onConflict: "user_id,version", ignoreDuplicates: true }
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, version: TERMS_VERSION })
}
