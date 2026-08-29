// Single provider interface over the fal.ai queue API. All generation calls go
// through here — never call fal from anywhere else.
import { createHash, createPublicKey, verify as edVerify } from "node:crypto"
import sharp from "sharp"
import { MODELS, type ProviderKey } from "@/config/models"

const FAL_QUEUE = "https://queue.fal.run"

function falHeaders() {
  return {
    Authorization: `Key ${process.env.FAL_KEY}`,
    "Content-Type": "application/json",
  }
}

// Queue request paths use only the owner/model segments even when the endpoint
// has a subpath (e.g. fal-ai/gemini-25-flash-image/edit).
function basePath(falId: string) {
  return falId.split("/").slice(0, 2).join("/")
}

// gemini's edit endpoint takes the OUTPUT aspect ratio from the REFERENCE
// image, not the primary (measured live 2026-08-29, DECISIONS.md) — prompt
// instructions to preserve the framing do not override it. Letterbox every
// aspect-mismatched ref onto a canvas at the primary's aspect so the primary's
// shape is the only one the model sees. Padded refs go up as data URIs (no
// storage round trip); refs are style references, so the REF_MAX_DIM downscale
// costs nothing.
const REF_MAX_DIM = 1536
const REF_ASPECT_TOLERANCE = 0.02

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch for ref padding failed (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

async function padRefsToPrimaryAspect(imageUrl: string, refUrls: string[]): Promise<string[]> {
  const meta = await sharp(await fetchImageBuffer(imageUrl)).metadata()
  if (!meta.width || !meta.height) return refUrls
  const target = meta.width / meta.height
  const [w, h] =
    target >= 1
      ? [REF_MAX_DIM, Math.round(REF_MAX_DIM / target)]
      : [Math.round(REF_MAX_DIM * target), REF_MAX_DIM]
  return Promise.all(
    refUrls.map(async (url) => {
      const buf = await fetchImageBuffer(url)
      const m = await sharp(buf).metadata()
      if (m.width && m.height && Math.abs(m.width / m.height - target) / target < REF_ASPECT_TOLERANCE)
        return url
      const padded = await sharp(buf)
        .resize(w, h, { fit: "contain", background: { r: 128, g: 128, b: 128 } })
        .jpeg({ quality: 90 })
        .toBuffer()
      return `data:image/jpeg;base64,${padded.toString("base64")}`
    })
  )
}

function buildInput(
  provider: ProviderKey,
  prompt: string,
  imageUrl: string,
  refUrls: string[]
) {
  // only gemini accepts multiple input images; refs are dropped elsewhere
  // (provider selection routes ref-carrying groups to gemini)
  if (provider === "gemini") return { prompt, image_urls: [imageUrl, ...refUrls] }
  return { prompt, image_url: imageUrl }
}

/** Submit a generation to the fal queue. Returns the fal request_id. */
export async function submitGeneration(
  provider: ProviderKey,
  prompt: string,
  imageUrl: string,
  webhookUrl?: string,
  refUrls: string[] = [],
  // provider-specific extras merged into the request body (e.g. image_size
  // for full-res 360 outputs on qwen — phase 17)
  extraInput?: Record<string, unknown>
): Promise<string> {
  const model = MODELS[provider]
  if (!model.falId) {
    // ponytail: LOCAL_ENDPOINT is a stub per CLAUDE.md — wiring is Matt's job
    throw new Error("Local endpoint not wired (LOCAL_IMAGING_BASE_URL)")
  }
  // only gemini takes refs (buildInput), and only gemini has the ref-aspect bug
  if (provider === "gemini" && refUrls.length) {
    refUrls = await padRefsToPrimaryAspect(imageUrl, refUrls)
  }
  const url = new URL(`${FAL_QUEUE}/${model.falId}`)
  if (webhookUrl) url.searchParams.set("fal_webhook", webhookUrl)
  const res = await fetch(url, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({ ...buildInput(provider, prompt, imageUrl, refUrls), ...extraInput }),
  })
  if (!res.ok) throw new Error(`fal submit failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  if (!data.request_id) throw new Error("fal submit returned no request_id")
  return data.request_id as string
}

export type FalStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | string

export async function getStatus(provider: ProviderKey, requestId: string): Promise<FalStatus> {
  const model = MODELS[provider]
  const res = await fetch(
    `${FAL_QUEUE}/${basePath(model.falId!)}/requests/${requestId}/status`,
    { headers: falHeaders() }
  )
  if (res.status === 404) return "NOT_FOUND"
  if (!res.ok) throw new Error(`fal status failed (${res.status})`)
  const data = await res.json()
  return data.status as FalStatus
}

/** Fetch the result payload; returns the first output image URL. */
export async function getResultImageUrl(
  provider: ProviderKey,
  requestId: string
): Promise<string> {
  const model = MODELS[provider]
  const res = await fetch(`${FAL_QUEUE}/${basePath(model.falId!)}/requests/${requestId}`, {
    headers: falHeaders(),
  })
  if (!res.ok) throw new Error(`fal result failed (${res.status}): ${await res.text()}`)
  return extractImageUrl(await res.json())
}

export function extractImageUrl(payload: unknown): string {
  const p = payload as { images?: { url?: string }[]; image?: { url?: string } }
  const url = p?.images?.[0]?.url ?? p?.image?.url
  if (!url) throw new Error("fal result contained no image")
  return url
}

// ---- Webhook signature verification (ED25519 against fal's JWKS) ----

const JWKS_URL = "https://rest.alpha.fal.ai/.well-known/jwks.json"
let jwksCache: { keys: { x: string }[]; fetchedAt: number } | null = null

async function getJwks() {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 24 * 3600_000) return jwksCache.keys
  const res = await fetch(JWKS_URL)
  if (!res.ok) throw new Error(`fal JWKS fetch failed (${res.status})`)
  const data = await res.json()
  jwksCache = { keys: data.keys ?? [], fetchedAt: Date.now() }
  return jwksCache.keys
}

/**
 * Verify a fal webhook delivery. Message = request_id, user_id, timestamp and
 * hex sha256 of the raw body, newline-joined, signed with ED25519.
 */
export async function verifyFalWebhook(
  rawBody: Buffer,
  headers: {
    requestId: string | null
    userId: string | null
    timestamp: string | null
    signature: string | null
  }
): Promise<boolean> {
  const { requestId, userId, timestamp, signature } = headers
  if (!requestId || !userId || !timestamp || !signature) return false
  // reject stale deliveries (replay window 5 min)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false

  const bodyHash = createHash("sha256").update(rawBody).digest("hex")
  const message = Buffer.from([requestId, userId, timestamp, bodyHash].join("\n"))
  const sig = Buffer.from(signature, "hex")

  const keys = await getJwks()
  for (const jwk of keys) {
    try {
      const key = createPublicKey({
        // fal pads its base64url x values; strict JWK import rejects padding
        key: { kty: "OKP", crv: "Ed25519", x: jwk.x.replace(/=+$/, "") },
        format: "jwk",
      })
      if (edVerify(null, message, key, sig)) return true
    } catch {
      // malformed key — try the next one
    }
  }
  return false
}
