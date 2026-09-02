import { readFileSync } from "node:fs"
import {
  connectionFailureMessage,
  safeNextPath,
  workflowFailureMessage,
} from "../lib/workflow-recovery.ts"

let assertions = 0
function assert(condition, message) {
  assertions += 1
  if (!condition) throw new Error(message)
}
function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}
function contains(source, value, message) {
  assert(source.includes(value), message)
}

assert(safeNextPath("/listings/one/proofing?photo=two") === "/listings/one/proofing?photo=two", "owned destination lost")
assert(safeNextPath("https://evil.example") === "/dashboard", "external redirect accepted")
assert(safeNextPath("//evil.example") === "/dashboard", "protocol-relative redirect accepted")
assert(safeNextPath("/login?next=/listings") === "/dashboard", "login loop accepted")
assert(safeNextPath(null, "/listings") === "/listings", "redirect fallback ignored")

const expired = workflowFailureMessage({ status: 401, fallback: "save failed", preserved: "Draft preserved." })
contains(expired, "sign-in expired", "expired auth is not named")
contains(expired, "Draft preserved.", "expired auth omits preserved state")
const conflict = workflowFailureMessage({ status: 409, serverMessage: "Preview changed.", fallback: "download failed", preserved: "Finals preserved." })
contains(conflict, "Preview changed.", "conflict reason lost")
contains(conflict, "Finals preserved.", "conflict preservation omitted")
contains(connectionFailureMessage("Queue preserved."), "Reconnect", "connection recovery action omitted")

const middleware = read("middleware.ts")
const login = read("app/(auth)/login/page.tsx")
contains(middleware, 'url.searchParams.set("next"', "middleware does not preserve the private destination")
contains(middleware, "safeNextPath", "middleware does not constrain the return path")
contains(login, "safeNextPath(searchParams.get(\"next\"))", "login does not return to the interrupted workflow")

const connectivity = read("components/workflow-connectivity.tsx")
contains(connectivity, 'addEventListener("offline"', "offline state is not observed")
contains(connectivity, 'addEventListener("online"', "reconnect state is not observed")
contains(connectivity, "router.refresh()", "reconnect does not refresh durable truth")
contains(connectivity, 'aria-live="polite"', "connectivity state is not announced")

const upload = read("app/listings/[id]/upload-queue.tsx")
contains(upload, "the device went offline", "active upload does not pause clearly offline")
contains(upload, "uploaded chunks", "upload recovery does not name preserved work")
contains(upload, "reselect the exact files", "web-platform resume limit is not disclosed")
contains(upload, "matchedIds", "duplicate file reselection can reuse one queue item")
contains(upload, "disabled={!online}", "offline intake can still start a reservation")

const button = read("components/ui/button.tsx")
contains(button, 'sm: "h-10', "small buttons remain below 40px")
contains(button, '"icon-xs": "size-10', "icon buttons remain below 40px")
const tools = read("app/listings/[id]/tools-nav.tsx")
contains(tools, "min-h-10", "mobile tool navigation is below 40px")
const photos = read("app/listings/[id]/photo-grid.tsx")
contains(photos, "h-10 w-10", "photo selection target is below 40px")
contains(photos, "Remove photo", "photo selection does not expose its action")

const listing = read("app/listings/[id]/listing-workspace.tsx")
contains(listing, "No listing photos yet", "empty listing has no specific state")
contains(listing, "Show all photos", "empty filter has no smallest recovery action")
contains(listing, "Your photos and organization decisions are unchanged", "empty filter does not name preserved state")

const proofing = read("app/listings/[id]/proofing/proofing-workspace.tsx")
contains(proofing, "proofing-draft:v1", "proofing draft does not survive interruption")
contains(proofing, "reviewRetry", "review retry identity is not persisted")
contains(proofing, "batchRetry", "batch retry identity is not persisted")
contains(proofing, "This secure image link expired", "proofing does not identify stale image links")
contains(proofing, "Retry image", "proofing image failure has no recovery")
contains(proofing, "Sign in again", "proofing auth expiry has no direct action")
contains(proofing, 'event.key === "ArrowLeft"', "proofing keyboard navigation regressed")

const result = read("app/listings/[id]/f/[fileGroupId]/file-group-workspace.tsx")
contains(result, "result-draft:v1", "result-workspace draft does not survive interruption")
contains(result, "WorkflowConnectivity", "result workspace does not report offline state")
contains(result, "Retry image", "result workspace lost signed-image recovery")

const delivery = read("app/listings/[id]/delivery/delivery-workspace.tsx")
contains(delivery, "async function startDownload", "delivery has no recoverable download start")
contains(delivery, "/delivery?profileId=", "download does not preflight current finals")
contains(delivery, "current.fingerprint !== preview.fingerprint", "stale package preview can download")
contains(delivery, "If the browser or connection interrupts it", "download interruption recovery is not explained")
contains(delivery, "Approved finals and saved delivery profiles are unchanged", "delivery failure does not name preserved state")

const css = read("app/globals.css")
contains(css, "prefers-reduced-motion: reduce", "reduced motion contract missing")
const beforeAfter = read("components/before-after.tsx")
contains(beforeAfter, 'aria-valuetext={`${pos}%', "comparison value is not announced")
contains(beforeAfter, 'e.key === "Home"', "comparison keyboard endpoints missing")

console.log(`Phase 54 mobile workflow: ${assertions} assertions passed`)
