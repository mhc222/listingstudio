"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"
import { Collapsible } from "radix-ui"

import { cn } from "@/lib/utils"

type DisclosureProps = {
  summary: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
  triggerClassName?: string
  contentClassName?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function Disclosure({
  summary,
  children,
  defaultOpen,
  className,
  triggerClassName,
  contentClassName,
  open,
  onOpenChange,
}: DisclosureProps) {
  return (
    <Collapsible.Root
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
      className={cn("group/disclosure", className)}
    >
      <Collapsible.Trigger
        className={cn(
          "ls-pressable flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-sm font-medium text-muted-foreground outline-none hover:bg-card/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35",
          triggerClassName
        )}
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-200 ease-[var(--ease-fluid)] group-data-[state=open]/disclosure:rotate-90"
        />
      </Collapsible.Trigger>
      <Collapsible.Content forceMount className="ls-disclosure-content">
        <div className="min-h-0 overflow-hidden">
          <div className={cn("px-2.5 pb-2.5 pt-1", contentClassName)}>{children}</div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export { Disclosure }
