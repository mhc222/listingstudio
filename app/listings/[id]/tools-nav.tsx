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
  { seg: "proofing", label: "Proofing" },
  { seg: "delivery", label: "Delivery" },
  { seg: "activity", label: "Activity" },
] as const

export function ToolsNav({ listingId }: { listingId: string }) {
  const pathname = usePathname()
  const base = `/listings/${listingId}`
  return (
    <nav className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1.5 text-sm" aria-label="Listing tools">
      {TOOLS.map((t) => {
        const href = t.seg ? `${base}/${t.seg}` : base
        const active = pathname === href
        return (
          <Link
            key={t.label}
            href={href}
            className={`ls-pressable flex min-h-10 shrink-0 items-center rounded-xl px-3 py-2 font-medium ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/55 hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
