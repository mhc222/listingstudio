import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"

export default async function Dashboard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Listing Studio</h1>
        <form action="/auth/signout" method="post">
          <Button variant="outline" type="submit">
            Sign out
          </Button>
        </form>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user?.email}
      </p>
      <div className="mt-10 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
        No listings yet. Listings arrive in Phase 2.
      </div>
    </main>
  )
}
