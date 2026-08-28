import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { getUrls } from "@/lib/storage"
import { SampleUpload } from "./sample-upload"

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: samples } = await supabase
    .from("sample_images")
    .select("id, label, storage_path")
    .order("created_at", { ascending: false })

  const urls = await getUrls("references", (samples ?? []).map((s) => s.storage_path))

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Link href="/listings" className="text-sm text-muted-foreground hover:underline">
        ← Listings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Sample library</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Reusable reference images, attachable to any job.
      </p>

      <div className="mt-6">
        <SampleUpload />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {(samples ?? []).map((s) => (
          <figure key={s.id} className="overflow-hidden rounded-lg border">
            {urls[s.storage_path] && (
              // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
              <img src={urls[s.storage_path]} alt={s.label ?? ""} className="aspect-video w-full object-cover" />
            )}
            <figcaption className="truncate px-2 py-1.5 text-xs text-muted-foreground">
              {s.label ?? "Untitled"}
            </figcaption>
          </figure>
        ))}
        {(samples ?? []).length === 0 && (
          <p className="col-span-full text-sm text-muted-foreground">
            No samples yet — upload style references above.
          </p>
        )}
      </div>
    </main>
  )
}
