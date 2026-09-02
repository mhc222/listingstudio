"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

export function useOnlineState() {
  const [online, setOnline] = useState(true)
  const [reconnected, setReconnected] = useState(false)

  useEffect(() => {
    setOnline(navigator.onLine)
    const handleOffline = () => {
      setOnline(false)
      setReconnected(false)
    }
    const handleOnline = () => {
      setOnline(true)
      setReconnected(true)
    }
    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)
    return () => {
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
    }
  }, [])

  return { online, reconnected, clearReconnect: () => setReconnected(false) }
}

export function WorkflowConnectivity({
  preserved,
  onReconnect,
}: {
  preserved: string
  onReconnect?: () => void
}) {
  const router = useRouter()
  const { online, reconnected, clearReconnect } = useOnlineState()

  useEffect(() => {
    if (!reconnected) return
    onReconnect?.()
    router.refresh()
    const timer = window.setTimeout(clearReconnect, 3500)
    return () => window.clearTimeout(timer)
  }, [clearReconnect, onReconnect, reconnected, router])

  if (online && !reconnected) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-4 border-l-2 px-3 py-2 text-sm ${online ? "border-state-complete bg-card/75" : "border-state-failed bg-destructive/5"}`}
    >
      <p className="font-semibold">{online ? "Back online" : "You’re offline"}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {online ? `Refreshing saved workflow state. ${preserved}` : `${preserved} Reconnect to continue.`}
      </p>
    </div>
  )
}
