import * as React from "react"

import { cn } from "@/lib/utils"

// Styled NATIVE select, not radix — drop-in for the raw <select>s across the
// panels (same value/onChange API), which radix's Select is not.
// appearance-none strips the OS chrome (the beveled macOS bevel/arrow that
// clashed with the flat brand buttons); we paint our own chevron instead.
// ponytail: chevron is a fixed mid-gray data-URI (reads in light+dark) rather
// than a theme token — a CSS var can't live inside a background data-URI.
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

function Select({ className, style, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      style={{
        backgroundImage: CHEVRON,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 0.45rem center",
        ...style,
      }}
      className={cn(
        "h-10 w-full min-w-0 appearance-none rounded-[0.65rem] border border-border/80 bg-card/80 px-3 py-1 pr-8 text-sm shadow-[inset_0_1px_1px_rgba(47,37,25,0.03)] transition-[background-color,border-color,box-shadow] duration-200 outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "hover:border-input focus-visible:border-ring focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/30",
        className
      )}
      {...props}
    />
  )
}

export { Select }
