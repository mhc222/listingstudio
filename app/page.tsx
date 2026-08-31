import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { BOXBROWNIE_CENTS, BOXBROWNIE_DEFAULT_CENTS } from "@/config/models"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardLive, RerunButton } from "./dashboard-live"
import { StatePill, Wordmark } from "@/components/brand"

type ChainStep = { edit_type: string }

function centsLabel(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function chainLabel(chain: ChainStep[]): string {
  return chain
    .filter((s) => s.edit_type !== "REWORK")
    .map((s) => s.edit_type.replaceAll("_", " ").toLowerCase())
    .join(" → ")
}

// BoxBrownie price for one completed output's edit chain (reworks are free there)
function bbCents(chain: ChainStep[]): number {
  return chain
    .filter((s) => s.edit_type !== "REWORK")
    .reduce((sum, s) => sum + (BOXBROWNIE_CENTS[s.edit_type] ?? BOXBROWNIE_DEFAULT_CENTS), 0)
}

export default async function Dashboard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [listingsQ, activeQ, failedQ, ledgerQ] = await Promise.all([
    supabase
      .from("listings")
      .select("id, address, mls_number, created_at, photos(count)")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("jobs")
      .select("id, title, status, created_at, listings(address), file_groups(step_status)")
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("file_groups")
      .select("id, last_error, edit_chain, created_at, jobs(title, listings(address))")
      .eq("step_status", "failed")
      .order("created_at", { ascending: false })
      .limit(12),
    // Admin client: RLS scopes the ledger via job_id, which hides pre-job
    // interpreter rows (job_id null) — MTD spend must count every call.
    createAdminClient()
      .from("spend_ledger")
      .select("edit_type, kind, cost_cents")
      .gte("created_at", monthStart.toISOString()),
  ])

  const listings = listingsQ.data ?? []
  const activeJobs = activeQ.data ?? []
  const failedGroups = failedQ.data ?? []
  const ledger = ledgerQ.data ?? []

  // MTD spend by edit type (kind labels the null-edit_type rows: interpreter, qa…)
  const byType = new Map<string, number>()
  let mtdTotal = 0
  for (const row of ledger) {
    const key = row.edit_type ?? row.kind
    const cents = Number(row.cost_cents)
    byType.set(key, (byType.get(key) ?? 0) + cents)
    mtdTotal += cents
  }
  const spendRows = [...byType.entries()].sort((a, b) => b[1] - a[1])

  // Per-listing BoxBrownie comparison over completed outputs
  const listingIds = listings.map((l) => l.id)
  const { data: costJobs } = listingIds.length
    ? await supabase
        .from("jobs")
        .select("listing_id, total_cost_cents, file_groups(step_status, edit_chain)")
        .in("listing_id", listingIds)
    : { data: [] }
  const perListing = new Map<string, { our: number; bb: number }>()
  for (const j of costJobs ?? []) {
    const entry = perListing.get(j.listing_id) ?? { our: 0, bb: 0 }
    entry.our += j.total_cost_cents
    for (const fg of j.file_groups as unknown as { step_status: string; edit_chain: ChainStep[] }[]) {
      if (fg.step_status === "complete") entry.bb += bbCents(fg.edit_chain)
    }
    perListing.set(j.listing_id, entry)
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <DashboardLive />
      <div className="flex items-center justify-between">
        <h1>
          <Wordmark />
        </h1>
        <div className="flex items-center gap-4">
          <Link href="/listings" className="text-sm text-muted-foreground hover:underline">
            Listings
          </Link>
          <Link href="/library" className="text-sm text-muted-foreground hover:underline">
            Sample library
          </Link>
          <form action="/auth/signout" method="post">
            <Button variant="outline" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Signed in as {user?.email}</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Jobs in progress</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {activeJobs.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing running.</p>
            )}
            {activeJobs.map((j) => {
              const fgs = j.file_groups as unknown as { step_status: string }[]
              const done = fgs.filter((f) => f.step_status === "complete").length
              const listing = j.listings as unknown as { address: string } | null
              return (
                <div key={j.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{j.title}</span>
                    <StatePill status={j.status} />
                  </div>
                  <div className="text-muted-foreground">
                    {listing?.address} ·{" "}
                    <span className="font-ui tabular-nums">
                      {done}/{fgs.length}
                    </span>{" "}
                    outputs done
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Failed jobs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {failedGroups.length === 0 && (
              <p className="text-sm text-muted-foreground">No failures.</p>
            )}
            {failedGroups.map((fg) => {
              const job = fg.jobs as unknown as {
                title: string
                listings: { address: string } | null
              } | null
              return (
                <div key={fg.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{job?.title}</div>
                    <div className="text-muted-foreground">
                      {job?.listings?.address} · {chainLabel(fg.edit_chain as ChainStep[])}
                    </div>
                    {fg.last_error && (
                      <div className="truncate text-xs text-destructive">{fg.last_error}</div>
                    )}
                  </div>
                  <RerunButton fileGroupId={fg.id} />
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">
            Spend this month ·{" "}
            {/* the one number worth colouring — the argument against a $220 invoice */}
            <span className="font-ui tabular-nums text-primary">{centsLabel(mtdTotal)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {spendRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No spend yet this month.</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2">
              {spendRows.map(([type, cents]) => (
                <div key={type} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {type.replaceAll("_", " ").toLowerCase()}
                  </span>
                  <span className="font-ui tabular-nums">{centsLabel(cents)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-medium">Recent listings</h2>
        <Link href="/listings" className="text-sm text-primary underline">
          All listings →
        </Link>
      </div>
      <div className="mt-3 grid gap-3">
        {listings.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No listings yet.{" "}
            <Link href="/listings" className="text-primary underline">
              Create one →
            </Link>
          </p>
        )}
        {listings.map((l) => {
          const costs = perListing.get(l.id)
          return (
            <Link key={l.id} href={`/listings/${l.id}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <div className="font-medium">{l.address}</div>
                    <div className="text-sm text-muted-foreground">
                      {l.mls_number ? `MLS ${l.mls_number} · ` : ""}
                      {(l.photos as unknown as { count: number }[])[0]?.count ?? 0} photos
                    </div>
                  </div>
                  <div className="text-right font-ui text-sm tabular-nums">
                    {costs && costs.bb > 0 ? (
                      <>
                        <div className="font-medium">{centsLabel(costs.our)}</div>
                        <div className="text-muted-foreground">
                          vs ~{centsLabel(costs.bb)} at BoxBrownie
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {costs?.our ? centsLabel(costs.our) : "—"}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
