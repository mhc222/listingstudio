import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Wordmark } from "@/components/brand"
import { BeforeAfterDemo } from "./landing-showcase"

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
    <main className="mx-auto max-w-6xl px-6">
      {/* Top bar */}
      <div className="flex items-center justify-between py-6">
        <Wordmark />
        <Button asChild variant="outline">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      </div>

      {/* Hero */}
      <section className="py-16 sm:py-24">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Real estate photography, transformed
        </p>
        <h1 className="mt-4 max-w-3xl text-balance text-5xl leading-[1.03] sm:text-6xl">
          Editorial listing photos in minutes — not a three-day, thirty-dollar wait.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Enhance, stage, and finish every photo by describing what you want in plain language.
          The studio compiles it into the precise edit — and keeps the room exactly as it is.
        </p>
        <div className="mt-10">
          <Button asChild size="lg">
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        </div>
      </section>

      {/* Showcase: slider + the chat moment that produced it */}
      <section className="grid items-center gap-10 border-t border-border py-16 lg:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Drag to compare</p>
          <h2 className="mt-3 text-3xl">Same room. Better light.</h2>
          <BeforeAfterDemo
            before="/demo/before.jpg"
            after="/demo/after.jpg"
            caption="Drag the handle — walls, windows, and camera angle stay untouched."
          />
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            You talk. It compiles.
          </p>

          {/* User message — plain language */}
          <div className="self-end rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-sm text-accent-foreground shadow-sm">
            &ldquo;this living room is way too dark and kinda empty — warm it up and put some
            furniture in there&rdquo;
          </div>

          {/* Compiled — detailed prompt with preservation */}
          <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm shadow-sm">
            <div className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Compiled edit
            </div>
            <p className="font-medium">Image Enhancement → Virtual Staging</p>
            <p className="mt-2 text-muted-foreground">
              Bright natural daylight, warm 2700K interior glow; mid-century furniture realistically
              scaled to the room.
            </p>
            <p className="mt-2 text-muted-foreground">
              Do not alter room dimensions, wall positions, window or door placement, flooring,
              ceiling height, or camera perspective.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Tag>Lighting preserved</Tag>
              <Tag>Geometry locked</Tag>
              <Tag>Minutes, not days</Tag>
            </div>
          </div>
        </div>
      </section>

      {/* The old way vs. the studio */}
      <section className="border-t border-border py-16">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Why bother</p>
        <h2 className="mt-3 max-w-2xl text-3xl">
          Outsourced editing is slow and priced by the photo. This isn&rsquo;t.
        </h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          <Compare
            head="The old way"
            muted
            rows={[
              "Three to five day turnaround",
              "Around thirty dollars a photo — again for every revision",
              "Email a brief, wait, hope they read it",
              "Revisions are a new ticket and a new charge",
            ]}
          />
          <Compare
            head="Listing Studio"
            rows={[
              "Finished in minutes, on your own schedule",
              "One workspace, not an invoice per image",
              "Describe it in plain words and watch it happen",
              "Refine right in the chat — every version kept",
            ]}
          />
        </div>
      </section>

      {/* Closing steps */}
      <section className="grid gap-8 border-t border-border py-16 sm:grid-cols-3">
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
            <h3 className="text-2xl">{f.h}</h3>
            <p className="mt-3 text-sm text-muted-foreground">{f.p}</p>
          </div>
        ))}
      </section>

      {/* Final CTA */}
      <section className="border-t border-border py-20 text-center">
        <h2 className="mx-auto max-w-2xl text-balance text-4xl">
          Your next listing deserves better photos by this afternoon.
        </h2>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-accent-foreground">
      {children}
    </span>
  )
}

function Compare({
  head,
  rows,
  muted = false,
}: {
  head: string
  rows: string[]
  muted?: boolean
}) {
  return (
    <div className={`p-6 ${muted ? "bg-popover" : "bg-card"}`}>
      <div
        className={`text-xs uppercase tracking-[0.18em] ${
          muted ? "text-muted-foreground" : "text-[var(--accent-foreground)]"
        }`}
      >
        {head}
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <li
            key={r}
            className={`text-sm ${muted ? "text-muted-foreground" : "text-foreground"}`}
          >
            {r}
          </li>
        ))}
      </ul>
    </div>
  )
}
