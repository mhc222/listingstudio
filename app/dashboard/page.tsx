import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { DashboardLive, RerunButton } from "./dashboard-live"
import { StatePill, Wordmark } from "@/components/brand"
import { createListing } from "@/app/listings/actions"

type ChainStep = { edit_type: string }

function chainLabel(chain: ChainStep[]): string {
  return chain
    .filter((s) => s.edit_type !== "REWORK")
    .map((s) => s.edit_type.replaceAll("_", " ").toLowerCase())
    .join(" → ")
}

export default async function Dashboard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [listingsQ, activeQ, failedQ] = await Promise.all([
    supabase
      .from("listings")
      .select("id, address, mls_number, created_at")
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
  ])

  const listings = listingsQ.data ?? []
  const activeJobs = activeQ.data ?? []
  const failedGroups = failedQ.data ?? []

  // Counts use logical photos: confirmed HDR source exposures collapse behind
  // their one merged representative. Attachments remain a separate total.
  const listingIds = listings.map((l) => l.id)
  const [{ data: photos }, { data: confirmedGroups }, { data: groupMembers }] = listingIds.length
    ? await Promise.all([
      supabase
        .from("photos")
        .select("id, listing_id, storage_path, is_floor_plan, photo_role, created_at")
        .in("listing_id", listingIds)
        .order("created_at", { ascending: true }),
      supabase.from("photo_groups").select("id, listing_id, representative_photo_id")
        .in("listing_id", listingIds).eq("state", "confirmed"),
      supabase.from("photo_group_members").select("group_id, photo_id, photo_groups!inner(listing_id)")
        .in("photo_groups.listing_id", listingIds),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }]
  const confirmedIds = new Set((confirmedGroups ?? []).map((group) => group.id))
  const hiddenMembers = new Set((groupMembers ?? []).filter((member) => confirmedIds.has(member.group_id)).map((member) => member.photo_id))
  const representativeIds = new Set((confirmedGroups ?? []).map((group) => group.representative_photo_id).filter(Boolean))
  const coverPath = new Map<string, string>()
  const photoCount = new Map<string, number>()
  const floorPlanCount = new Map<string, number>()
  const sourceCount = new Map<string, number>()
  for (const p of photos ?? []) {
    if (p.is_floor_plan) {
      floorPlanCount.set(p.listing_id, (floorPlanCount.get(p.listing_id) ?? 0) + 1)
      continue
    }
    if (p.photo_role === "source") sourceCount.set(p.listing_id, (sourceCount.get(p.listing_id) ?? 0) + 1)
    const logical = !hiddenMembers.has(p.id) && (p.photo_role !== "hdr_merged" || representativeIds.has(p.id))
    if (!logical) continue
    photoCount.set(p.listing_id, (photoCount.get(p.listing_id) ?? 0) + 1)
    if (!coverPath.has(p.listing_id)) coverPath.set(p.listing_id, p.storage_path)
  }
  const coverUrls = await getUrls("originals", [...coverPath.values()])

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <DashboardLive />
      <div className="ls-material sticky top-3 z-20 flex items-center justify-between px-4 py-3">
        <Wordmark />
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

      <header className="mt-12">
        <h1 className="text-4xl font-semibold tracking-[-0.04em]">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
      </header>

      <div className="mt-10 flex items-baseline justify-between">
        <h2>Recent listings</h2>
        <Link href="/listings" className="text-sm text-primary hover:underline">
          All listings →
        </Link>
      </div>

      {/* create a listing right here — no need to detour to /listings first */}
      <form
        action={createListing}
        className="ls-surface mt-4 flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
      >
        <Input name="address" placeholder="New listing address" required className="flex-1" />
        <Input name="mls_number" placeholder="MLS # (optional)" className="sm:w-48" />
        <Button type="submit">Create listing</Button>
      </form>

      {listings.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No listings yet.{" "}
          <Link href="/listings" className="text-primary underline">
            Create one →
          </Link>
        </p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => {
            const path = coverPath.get(l.id)
            const cover = path ? coverUrls[path] : null
            const count = photoCount.get(l.id) ?? 0
            const plans = floorPlanCount.get(l.id) ?? 0
            const sources = sourceCount.get(l.id) ?? 0
            const sourceDetail = sources !== count ? ` · ${sources} source files` : ""
            const meta = `${l.mls_number ? `MLS ${l.mls_number} · ` : ""}${count} photo${count === 1 ? "" : "s"} · ${plans} floor plan${plans === 1 ? "" : "s"}${sourceDetail}`
            return (
              <Link key={l.id} href={`/listings/${l.id}`} className="group">
                <Card className="ls-pressable overflow-hidden p-0 hover:-translate-y-1 hover:shadow-[0_18px_46px_rgba(45,35,23,0.12)]">
                  <div className="relative aspect-[4/3] w-full bg-muted">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cover}
                        alt={l.address}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground">
                        <span className="text-xl font-semibold tracking-[-0.03em]">
                          {l.address}
                        </span>
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
                      <div className="text-lg font-semibold leading-tight tracking-[-0.025em] text-white">
                        {l.address}
                      </div>
                      <div className="mt-0.5 text-xs uppercase tracking-wide text-white/70">
                        {meta}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {(activeJobs.length > 0 || failedGroups.length > 0) && (
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {activeJobs.length > 0 && (
            <Card>
              <CardContent className="grid gap-3 py-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  In progress
                </div>
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
          )}

          {failedGroups.length > 0 && (
            <Card>
              <CardContent className="grid gap-3 py-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Failed</div>
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
          )}
        </div>
      )}
    </main>
  )
}
