"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

// Tracked-uppercase subnav rendered on the listing page + every tool route.
// "Photos" is the listing page itself; the rest are child routes.
const TOOLS = [
  { seg: "", label: "Photos" },
  { seg: "aerial", label: "Aerial" },
  { seg: "reel", label: "Reel" },
  { seg: "tour", label: "Tour" },
  { seg: "plan", label: "Plan" },
  { seg: "copy", label: "Copy" },
  { seg: "activity", label: "Activity" },
] as const

export function ToolsNav({ listingId }: { listingId: string }) {
  const pathname = usePathname()
  const base = `/listings/${listingId}`
  return (
    <nav className="flex flex-wrap gap-x-6 gap-y-2 border-b border-border pb-3 text-xs uppercase tracking-[0.18em]">
      {TOOLS.map((t) => {
        const href = t.seg ? `${base}/${t.seg}` : base
        const active = pathname === href
        return (
          <Link
            key={t.label}
            href={href}
            className={active ? "text-primary" : "text-muted-foreground hover:text-foreground"}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
