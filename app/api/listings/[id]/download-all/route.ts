import { NextResponse } from "next/server"
import { packageBasename } from "@/lib/delivery"
import { loadDeliveryPackageContext } from "@/lib/delivery-server"
import { renderDeliveryImage } from "@/lib/deliver"
import { download } from "@/lib/storage"
import { createStreamingZip, type StreamingZipEntry } from "@/lib/stream-zip"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type ManifestPhoto = {
  filename: string
  sourcePhotoId: string
  originalFilename: string
  selectedSource: string
  selectedVersion: string
  transformation: string
  disclosure: string
  width: number | null
  height: number | null
  bytes: number
}

function disclosureText(address: string, filename: string) {
  return [
    "VIRTUAL STAGING DISCLOSURE",
    "",
    `Property: ${address}`,
    `Photo: ${filename}`,
    "This image contains virtual staging or virtual renovation. Furnishings, finishes, or other depicted elements may not be physically present at the property.",
    "",
  ].join("\n")
}

function manifestText({ address, profileName, generatedAt, photos, companions }: {
  address: string
  profileName: string
  generatedAt: string
  photos: ManifestPhoto[]
  companions: string[]
}) {
  const lines = [
    "LISTING STUDIO DELIVERY MANIFEST",
    "",
    `Property: ${address}`,
    `Delivery profile: ${profileName}`,
    `Generated: ${generatedAt}`,
    `Approved photos: ${photos.length}`,
    "",
  ]
  for (const [index, photo] of photos.entries()) {
    lines.push(
      `${index + 1}. ${photo.filename}`,
      `   Original: ${photo.originalFilename}`,
      `   Source ID: ${photo.sourcePhotoId}`,
      `   Selection: ${photo.selectedSource} · ${photo.selectedVersion}`,
      `   Transformation: ${photo.transformation}`,
      `   Disclosure: ${photo.disclosure}`,
      `   Dimensions: ${photo.width ?? "unknown"} × ${photo.height ?? "unknown"} px`,
      `   Bytes: ${photo.bytes.toLocaleString("en-US")}`,
      ""
    )
  }
  lines.push(
    "ARCHIVE CONTENTS",
    ...photos.map((photo) => `- ${photo.filename}`),
    ...companions.map((name) => `- ${name}`),
    "- manifest.txt",
    ""
  )
  return lines.join("\n")
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const search = new URL(req.url).searchParams
  const profileId = search.get("profileId")
  const expectedFingerprint = search.get("fingerprint")
  if (!profileId || !expectedFingerprint) {
    return NextResponse.json({ error: "Preview the package before downloading it." }, { status: 400 })
  }

  let context
  try {
    context = await loadDeliveryPackageContext(supabase, id, profileId)
  } catch {
    return NextResponse.json({ error: "Could not prepare the delivery package." }, { status: 500 })
  }
  if (!context) return NextResponse.json({ error: "Listing or delivery profile not found." }, { status: 404 })
  const { preview, candidates } = context
  if (!preview.canDownload) {
    return NextResponse.json({ error: "The package is blocked until every current photo has a valid approved final.", preview }, { status: 409 })
  }
  if (preview.fingerprint !== expectedFingerprint) {
    return NextResponse.json({ error: "Finals or profile settings changed after this preview. Review the refreshed package before downloading.", preview }, { status: 409 })
  }
  if (preview.warnings.length && search.get("acknowledge") !== preview.fingerprint) {
    return NextResponse.json({ error: "Acknowledge the listed QA and compliance warnings before downloading.", preview }, { status: 409 })
  }

  const storageClient = createAdminClient()
  const candidateByPhoto = new Map(candidates.map((candidate) => [candidate.sourcePhotoId, candidate]))
  const manifestPhotos: ManifestPhoto[] = []
  const companionNames: string[] = []
  const generatedAt = new Date()
  const entries: StreamingZipEntry[] = []

  for (const item of preview.included) {
    const candidate = candidateByPhoto.get(item.sourcePhotoId)
    if (!candidate) return NextResponse.json({ error: "The approved package changed. Preview it again." }, { status: 409 })
    const watermark = candidate.staged && (preview.profile.disclosure_mode === "watermark" || preview.profile.disclosure_mode === "watermark_and_companion")
    entries.push({
      name: item.generatedFilename,
      data: async () => {
        const source = await download(candidate.bucket, candidate.storagePath, storageClient)
        const rendered = await renderDeliveryImage(Buffer.from(await source.arrayBuffer()), preview.profile, watermark)
        manifestPhotos.push({
          filename: item.generatedFilename,
          sourcePhotoId: candidate.sourcePhotoId,
          originalFilename: candidate.originalFilename,
          selectedSource: item.source,
          selectedVersion: item.version,
          transformation: `${preview.profile.file_format.toUpperCase()}, quality ${preview.profile.quality}${preview.profile.max_width || preview.profile.max_height ? `, fit within ${preview.profile.max_width ?? "auto"} × ${preview.profile.max_height ?? "auto"} px` : ""}${preview.profile.max_bytes ? `, max ${preview.profile.max_bytes} bytes` : ""}`,
          disclosure: item.stagedDisclosure,
          width: rendered.width,
          height: rendered.height,
          bytes: rendered.buffer.length,
        })
        return rendered.buffer
      },
    })
    const companion = candidate.staged && (preview.profile.disclosure_mode === "companion" || preview.profile.disclosure_mode === "watermark_and_companion")
    if (companion) {
      const name = `disclosures/${item.generatedFilename.replace(/\.[^.]+$/, "")}-disclosure.txt`
      companionNames.push(name)
      entries.push({ name, data: async () => new TextEncoder().encode(disclosureText(preview.address, item.generatedFilename)) })
    }
  }
  entries.push({
    name: "manifest.txt",
    data: async () => new TextEncoder().encode(manifestText({
      address: preview.address,
      profileName: preview.profile.name,
      generatedAt: generatedAt.toISOString(),
      photos: manifestPhotos,
      companions: companionNames,
    })),
  })

  const filename = `${packageBasename(preview.address, preview.profile.name)}.zip`
  return new Response(createStreamingZip(entries, generatedAt), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
