import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-20 w-full min-w-0 rounded-[0.65rem] border border-border/80 bg-card/80 px-3 py-2 text-sm shadow-[inset_0_1px_1px_rgba(47,37,25,0.03)] transition-[background-color,border-color,box-shadow] duration-200 outline-none placeholder:text-muted-foreground/80 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "hover:border-input focus-visible:border-ring focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/30",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
