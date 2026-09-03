// Phase 56 backfill: derive the missing grid thumbs for every photo and output
// version already in storage. Idempotent (skips existing thumbs), additive
// (never touches sources, versions, or SpendLedger), driven by the DB rows so
// stray objects are ignored. Run manually with the service role:
//
//   npm run backfill:thumbs            # both buckets
//   npm run backfill:thumbs -- --dry   # count only, write nothing
//
// Matt runs this against production; workers never do.
import { createClient } from "@supabase/supabase-js"
import { download, info, storeThumb, type Bucket } from "../lib/storage.ts"
import { isThumbPath, thumbPathFor } from "../lib/thumbs.ts"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRole) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (npm run backfill:thumbs loads .env.local)")
  process.exit(1)
}
const dry = process.argv.includes("--dry")
const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

type Counts = { scanned: number; created: number; skipped: number; failed: number }

async function backfill(bucket: Bucket, table: string): Promise<Counts> {
  const counts: Counts = { scanned: 0, created: 0, skipped: 0, failed: 0 }
  const { data, error } = await admin.from(table).select("storage_path")
  if (error) throw error
  const paths = [...new Set((data ?? []).map((row) => row.storage_path as string).filter(Boolean))]
  for (const path of paths) {
    counts.scanned += 1
    // PDFs (floor plans) and any thumb objects themselves have nothing to derive
    if (isThumbPath(path) || path.toLowerCase().endsWith(".pdf")) {
      counts.skipped += 1
      continue
    }
    const thumbPath = thumbPathFor(path)
    try {
      await info(bucket, thumbPath, admin)
      counts.skipped += 1
      continue
    } catch {
      // missing → derive
    }
    if (dry) {
      counts.created += 1
      continue
    }
    try {
      const blob = await download(bucket, path, admin)
      await storeThumb(bucket, path, Buffer.from(await blob.arrayBuffer()), admin)
      counts.created += 1
    } catch (e) {
      counts.failed += 1
      console.warn(`${bucket}/${path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return counts
}

const originals = await backfill("originals", "photos")
console.log(`originals${dry ? " (dry run)" : ""}:`, originals)
const outputs = await backfill("outputs", "output_versions")
console.log(`outputs${dry ? " (dry run)" : ""}:`, outputs)
if (originals.failed + outputs.failed > 0) process.exit(2)
