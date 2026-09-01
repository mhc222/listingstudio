import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = process.cwd()
const read = (file) => readFileSync(path.join(root, file), "utf8")

const panel = read("app/listings/[id]/upload-panel.tsx")
const queue = read("app/listings/[id]/upload-queue.tsx")
const contract = read("lib/upload-queue.ts")
const recoveryRoute = read("app/api/uploads/route.ts")
const authorizeRoute = read("app/api/uploads/[itemId]/authorize/route.ts")

const checks = [
  ["listing launcher uses the resumable queue", panel.includes("<UploadQueue")],
  ["listing launcher no longer calls the multipart route", !panel.includes("/api/upload")],
  ["queue imports tus-js-client", queue.includes('from "tus-js-client"')],
  ["queue never constructs listing-intake FormData", !queue.includes("new FormData")],
  ["chunk target is exactly 6 MiB", contract.includes("6 * 1024 * 1024")],
  ["concurrency contract is exactly three", contract.includes("MAX_CONCURRENT_UPLOADS = 3")],
  ["scheduler enforces available capacity", queue.includes("MAX_CONCURRENT_UPLOADS - activeIds.current.size")],
  ["preflight occurs before reservation", queue.indexOf("validateBrowserUpload(file, kind)") < queue.indexOf('fetch("/api/uploads/prepare"')],
  ["TUS URL fingerprints are durable per upload item", queue.includes("queueFingerprint(item.id, file)")],
  ["direct TUS requests carry the authenticated bearer", queue.includes("Bearer ${session.access_token}")],
  ["previous TUS URLs are resumed", queue.includes("findPreviousUploads") && queue.includes("resumeFromPreviousUpload")],
  ["pause preserves the remote upload", queue.includes("upload.abort(false)")],
  ["cancel terminates the remote upload", queue.includes("upload.abort(true)")],
  ["reload merges durable upload rows", queue.includes("/api/uploads?listingId=")],
  ["reload explains local-file reselection", queue.includes("Choose the same file to continue")],
  ["file-picker recovery target is synchronous", queue.includes("recoveryTargetRef.current = target")],
  ["stale nonterminal browser rows are discarded", queue.includes("serverIds.has(item.id)")],
  ["retry-failed action exists", queue.includes("Retry failed")],
  ["photo and floor-plan launchers remain distinct", queue.includes("Upload photos") && queue.includes("Attach floor plan")],
  ["all required human statuses are defined", ["Waiting", "Uploading", "Finalizing", "Uploaded", "Needs attention", "Canceled"].every((label) => contract.includes(`\"${label}\"`))],
  ["recovery route authenticates and verifies listing ownership", recoveryRoute.includes("auth.getUser") && recoveryRoute.includes('.from("listings")')],
  ["recovery route returns only open batches", recoveryRoute.includes('.eq("status", "open")')],
  ["reauthorization is ownership-scoped", authorizeRoute.includes("getOwnedUploadItem")],
  ["reauthorization cannot mutate completed items", authorizeRoute.includes('["reserved", "failed"]')],
]

for (const [message, condition] of checks) assert.ok(condition, message)

console.log(`Upload queue contract: ${checks.length} assertions passed.`)
