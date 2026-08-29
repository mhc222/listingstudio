import { notFound } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { getUrls } from "@/lib/storage"
import { TourView } from "./tour-view"

// Public unauthenticated share page (also the iframe embed target). RLS blocks
// anon reads, so the tour is looked up with the admin client and pano URLs are
// signed server-side per request. Middleware exempts /tour from the auth gate.
export default async function TourPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const admin = createAdminClient()

  const { data: tour } = await admin
    .from("tours")
    .select("id, title, tour_scenes (id, name, storage_path, width, order_index, initial_yaw, hotspots)")
    .eq("slug", slug)
    .single()
  if (!tour || tour.tour_scenes.length === 0) notFound()

  const urls = await getUrls(
    "originals",
    tour.tour_scenes.map((s) => s.storage_path),
    3600,
    admin
  )
  const scenes = [...tour.tour_scenes]
    .sort((a, b) => a.order_index - b.order_index)
    .map((s) => ({
      id: s.id,
      name: s.name,
      url: urls[s.storage_path] ?? null,
      width: s.width,
      initial_yaw: s.initial_yaw,
      hotspots: s.hotspots ?? [],
    }))

  return (
    <main className="h-dvh w-full bg-black">
      <TourView title={tour.title} scenes={scenes} />
    </main>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data: tour } = await createAdminClient()
    .from("tours")
    .select("title")
    .eq("slug", slug)
    .single()
  return { title: tour?.title ?? "Virtual tour" }
}
