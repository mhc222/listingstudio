import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Wordmark } from "@/components/brand"

// Public product front door. No auth gate, no data fetch, no ledger, no prices.
// getUser only flips the CTA — the landing stays viewable either way.
export default async function Landing() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const cta = user
    ? { href: "/dashboard", label: "Go to dashboard" }
    : { href: "/login", label: "Sign in" }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col p-6">
      <div className="flex items-center justify-between">
        <Wordmark />
        <Button asChild variant="outline">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      </div>

      <section className="flex flex-1 flex-col justify-center py-20">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Real estate photography, transformed
        </p>
        <h1 className="mt-4 max-w-3xl text-balance text-5xl leading-[1.05] sm:text-6xl">
          Editorial-grade listing images, without the studio bill.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Enhance, stage, and finish every photo through a single conversational workspace —
          twilight conversions, virtual staging, floor plans, tours, and reels, all in one place.
        </p>
        <div className="mt-10 flex items-center gap-4">
          <Button asChild size="lg">
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-8 border-t border-border py-14 sm:grid-cols-3">
        {[
          {
            h: "Describe it",
            p: "Type what you want in plain language. The workspace compiles it into the right edits and shows you the plan before anything runs.",
          },
          {
            h: "Refine it",
            p: "React in chat and get a new version — geometry preserved, nothing overwritten, every version kept and branchable.",
          },
          {
            h: "Deliver it",
            p: "Download MLS-ready sizes, virtually-staged disclosure labels, listing copy, and video reels for every property.",
          },
        ].map((f) => (
          <div key={f.h}>
            <h2 className="text-2xl">{f.h}</h2>
            <p className="mt-3 text-sm text-muted-foreground">{f.p}</p>
          </div>
        ))}
      </section>
    </main>
  )
}
