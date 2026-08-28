import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { createListing } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function ListingsPage() {
  const supabase = await createClient()
  const { data: listings } = await supabase
    .from("listings")
    .select("id, address, mls_number, created_at, photos(count)")
    .order("created_at", { ascending: false })

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Listings</h1>
        <div className="flex gap-4">
          <Link href="/library" className="text-sm text-muted-foreground hover:underline">
            Sample library
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            Dashboard
          </Link>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">New listing</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createListing} className="flex flex-col gap-2 sm:flex-row">
            <Input name="address" placeholder="Address" required className="flex-1" />
            <Input name="mls_number" placeholder="MLS # (optional)" className="sm:w-48" />
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-3">
        {(listings ?? []).map((l) => (
          <Link key={l.id} href={`/listings/${l.id}`}>
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <div className="font-medium">{l.address}</div>
                  <div className="text-sm text-muted-foreground">
                    {l.mls_number ? `MLS ${l.mls_number} · ` : ""}
                    {new Date(l.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {(l.photos as unknown as { count: number }[])[0]?.count ?? 0} photos
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {!listings?.length && (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            No listings yet. Create one above.
          </div>
        )}
      </div>
    </main>
  )
}
