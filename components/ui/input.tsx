import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-[0.65rem] border border-border/80 bg-card/80 px-3 py-1 text-base shadow-[inset_0_1px_1px_rgba(47,37,25,0.03)] transition-[background-color,border-color,box-shadow] duration-200 outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "hover:border-input focus-visible:border-ring focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/30",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
