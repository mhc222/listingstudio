"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

// Refetch dashboard server data whenever job state changes anywhere.
export function DashboardLive() {
  const router = useRouter()
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel("dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () =>
        router.refresh()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "file_groups" }, () =>
        router.refresh()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [router])
  return null
}

export function RerunButton({ fileGroupId }: { fileGroupId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function rerun() {
    setBusy(true)
    await fetch(`/api/file-groups/${fileGroupId}/rerun`, { method: "POST" })
    setBusy(false)
    router.refresh()
  }
  return (
    <Button size="sm" variant="outline" onClick={rerun} disabled={busy}>
      {busy ? "Re-running…" : "Re-run"}
    </Button>
  )
}
