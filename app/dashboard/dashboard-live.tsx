"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

// Refetch the shared derived listing summaries whenever durable workflow truth changes.
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
      .on("postgres_changes", { event: "*", schema: "public", table: "output_versions" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "upload_items" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "photo_groups" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "room_analysis_runs" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "room_proposals" }, () => router.refresh())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [router])
  return null
}
