import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { getThumbUrls } from "@/lib/storage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { DashboardLive } from "./dashboard-live"
import { Wordmark } from "@/components/brand"
import { createListing } from "@/app/listings/actions"
import { loadListingStatuses } from "@/lib/listing-status-server"

const STATUS_LABELS = {
  uploading: "Uploading",
  organizing: "Organizing",
  queued: "Queued",
  editing: "Editing",
  review_pending: "Review pending",
  needs_attention: "Needs attention",
} as const

export default async function Dashboard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const listingsQ = await supabase
    .from("listings")
    .select("id, address, mls_number, created_at")
    .order("created_at", { ascending: false })
    .limit(6)

  const listings = listingsQ.data ?? []

  // Counts use logical photos: confirmed HDR source exposures collapse behind
  // their one merged representative. Attachments remain a separate total.
  const listingIds = listings.map((l) => l.id)
  const statusByListing = await loadListingStatuses(supabase, listingIds)
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
  const coverUrls = await getThumbUrls("originals", [...coverPath.values()])

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
            const status = statusByListing.get(l.id)
            const workflow = status && status.total > 0 ? ` · ${status.headline}` : ""
            const meta = `${l.mls_number ? `MLS ${l.mls_number} · ` : ""}${count} photo${count === 1 ? "" : "s"} · ${plans} floor plan${plans === 1 ? "" : "s"}${sourceDetail}${workflow}`
            return (
              <Link key={l.id} href={`/listings/${l.id}`} className="group">
                <Card className="ls-pressable overflow-hidden p-0 hover:-translate-y-1 hover:shadow-[0_18px_46px_rgba(45,35,23,0.12)]">
                  <div className="relative aspect-[4/3] w-full bg-muted">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cover}
                        alt={l.address}
                        loading="lazy"
                        decoding="async"
                        width={480}
                        height={360}
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

      {listings.some((listing) => (statusByListing.get(listing.id)?.total ?? 0) > 0) && (
        <Card className="mt-10">
          <CardContent className="py-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">What needs you</div>
            <div className="mt-2 divide-y divide-border">
              {listings
                .flatMap((listing) =>
                  (statusByListing.get(listing.id)?.items ?? []).map((item) => ({ listing, item }))
                )
                .sort((a, b) => Number(b.item.status === "needs_attention") - Number(a.item.status === "needs_attention"))
                .slice(0, 12)
                .map(({ listing, item }) => (
                  <Link key={`${listing.id}:${item.key}`} href={item.href} className="flex min-h-14 items-center justify-between gap-4 py-3 transition-opacity hover:opacity-70">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{listing.address} · {item.detail}</div>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-primary">{STATUS_LABELS[item.status]} →</span>
                  </Link>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
