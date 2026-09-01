export const LISTING_STATUS_ORDER = [
  "uploading",
  "organizing",
  "queued",
  "editing",
  "review_pending",
  "needs_attention",
] as const

export type ListingStatusKey = (typeof LISTING_STATUS_ORDER)[number]

export type ListingStatusItem = {
  key: string
  status: ListingStatusKey
  title: string
  detail: string
  href: string
  action: string
  source: "upload" | "organization" | "generation" | "result"
}

export type ListingStatusInput = {
  listingId: string
  uploadItems?: Array<{
    id: string
    originalFilename: string
    status: string
    error?: string | null
    isFloorPlan?: boolean
  }>
  photoGroups?: Array<{
    id: string
    state: string
    memberCount?: number
  }>
  roomAnalysisRuns?: Array<{
    id: string
    status: string
    error?: string | null
    createdAt: string
  }>
  roomProposals?: Array<{
    id: string
    photoId: string
    photoLabel?: string | null
    reviewState: string
    decision: string
  }>
  jobs?: Array<{
    id: string
    title: string
    status: string
    fileGroups: Array<{
      id: string
      primaryPhotoId?: string
      stepStatus: string
      lastError?: string | null
      outputVersions?: Array<{
        id: string
        versionNumber: number
        accessible?: boolean
      }>
    }>
  }>
}

export type ListingStatusSummary = {
  counts: Record<ListingStatusKey, number>
  items: ListingStatusItem[]
  total: number
  headline: "Needs attention" | "In progress" | "Review pending" | "No active work"
}

export function deriveJobDisplayStatus(
  groups: Array<{ stepStatus: string; outputCount: number }>,
  fallbackStatus = "pending"
): { status: string; label: string } {
  if (groups.some((group) => group.stepStatus === "failed" || (group.stepStatus === "complete" && group.outputCount === 0))) {
    return { status: "failed", label: "Needs attention" }
  }
  if (groups.some((group) => group.stepStatus === "running")) {
    return { status: "processing", label: "Editing" }
  }
  if (groups.some((group) => group.stepStatus === "queued")) {
    return { status: "queued", label: "Queued" }
  }
  if (groups.length > 0 && groups.every((group) => group.stepStatus === "complete" && group.outputCount > 0)) {
    return { status: "complete", label: "Review pending" }
  }
  return {
    status: fallbackStatus,
    label: fallbackStatus === "failed" || fallbackStatus === "partial_failure" ? "Needs attention" : fallbackStatus === "processing" ? "Editing" : "Queued",
  }
}

function cleanError(error: string | null | undefined, fallback: string) {
  return error?.trim() || fallback
}

function humanTitle(value: string) {
  const title = value.trim() || "Photo edit"
  return title.charAt(0).toUpperCase() + title.slice(1)
}

/**
 * One read-only projection of existing durable workflow rows. Nothing here is
 * persisted, and every returned item points back to the row/surface that owns
 * recovery. This is intentionally not a listing state machine.
 */
export function deriveListingStatus(input: ListingStatusInput): ListingStatusSummary {
  const listingHref = `/listings/${input.listingId}`
  const items: ListingStatusItem[] = []

  for (const upload of input.uploadItems ?? []) {
    if (upload.status === "reserved" || upload.status === "finalizing") {
      const finalizing = upload.status === "finalizing"
      items.push({
        key: `upload:${upload.id}`,
        status: "uploading",
        title: upload.originalFilename,
        detail: finalizing
          ? `Finalizing ${upload.isFloorPlan ? "floor plan" : "photo"}.`
          : `${upload.isFloorPlan ? "Floor plan" : "Photo"} is waiting, paused, or transferring.`,
        href: `${listingHref}#upload-queue`,
        action: finalizing ? "Check upload" : "Continue upload",
        source: "upload",
      })
    } else if (upload.status === "failed") {
      items.push({
        key: `upload:${upload.id}`,
        status: "needs_attention",
        title: upload.originalFilename,
        detail: cleanError(upload.error, "This upload needs to be retried."),
        href: `${listingHref}#upload-queue`,
        action: "Recover upload",
        source: "upload",
      })
    }
  }

  for (const group of input.photoGroups ?? []) {
    if (group.state !== "proposed") continue
    const count = Math.max(0, group.memberCount ?? 0)
    items.push({
      key: `hdr:${group.id}`,
      status: "organizing",
      title: count ? `HDR stack · ${count} exposures` : "HDR stack proposal",
      detail: "Confirm the bracket stack or keep its photos separate.",
      href: `${listingHref}#shoot-organization`,
      action: "Review stack",
      source: "organization",
    })
  }

  const latestRoomRun = [...(input.roomAnalysisRuns ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )[0]
  if (latestRoomRun && ["pending", "running"].includes(latestRoomRun.status)) {
    items.push({
      key: `room-run:${latestRoomRun.id}`,
      status: "organizing",
      title: "Room review is running",
      detail: "Photos remain usable while room suggestions are prepared.",
      href: `${listingHref}#room-organization`,
      action: "View room review",
      source: "organization",
    })
  } else if (latestRoomRun && ["partial", "failed"].includes(latestRoomRun.status)) {
    items.push({
      key: `room-run:${latestRoomRun.id}`,
      status: "needs_attention",
      title: latestRoomRun.status === "partial" ? "Room review is incomplete" : "Room review failed",
      detail: cleanError(latestRoomRun.error, "Existing room tags are safe; review or try again."),
      href: `${listingHref}#room-organization`,
      action: "Recover organization",
      source: "organization",
    })
  }

  for (const proposal of input.roomProposals ?? []) {
    if (proposal.decision !== "pending") continue
    const title = proposal.photoLabel?.trim() || `Photo ${proposal.photoId.slice(0, 8)}`
    items.push({
      key: `room-proposal:${proposal.id}`,
      status: "organizing",
      title,
      detail:
        proposal.reviewState === "suggested"
          ? "A room suggestion is ready to confirm."
          : "Choose a room or deliberately leave this photo untagged.",
      href: `${listingHref}#room-organization`,
      action: "Review room",
      source: "organization",
    })
  }

  for (const job of input.jobs ?? []) {
    if (job.fileGroups.length === 0 && ["pending", "processing"].includes(job.status)) {
      items.push({
        key: `job:${job.id}`,
        status: job.status === "pending" ? "queued" : "editing",
        title: humanTitle(job.title),
        detail: job.status === "pending" ? "Waiting to prepare this edit." : "Preparing this edit.",
        href: `${listingHref}/activity#job-${job.id}`,
        action: "Open activity",
        source: "generation",
      })
    }

    for (const group of job.fileGroups) {
      const href = `${listingHref}/f/${group.id}`
      const title = humanTitle(job.title)
      if (group.stepStatus === "queued") {
        items.push({
          key: `file-group:${group.id}`,
          status: "queued",
          title,
          detail: "This photo is waiting to start.",
          href,
          action: "Open edit",
          source: "generation",
        })
      } else if (group.stepStatus === "running") {
        items.push({
          key: `file-group:${group.id}`,
          status: "editing",
          title,
          detail: "This photo is being edited now.",
          href,
          action: "View progress",
          source: "generation",
        })
      } else if (group.stepStatus === "failed") {
        items.push({
          key: `file-group:${group.id}`,
          status: "needs_attention",
          title,
          detail: cleanError(group.lastError, "This edit needs another try."),
          href,
          action: "Recover edit",
          source: "generation",
        })
      } else if (group.stepStatus === "complete") {
        const latest = [...(group.outputVersions ?? [])].sort(
          (a, b) => b.versionNumber - a.versionNumber
        )[0]
        if (!latest || latest.accessible === false) {
          items.push({
            key: `result:${group.id}`,
            status: "needs_attention",
            title,
            detail: latest
              ? "The finished image could not be loaded. Reload it from the edit workspace."
              : "The edit finished without a reviewable image.",
            href,
            action: "Recover image",
            source: "result",
          })
        } else {
          items.push({
            key: `result:${group.id}`,
            status: "review_pending",
            title,
            detail: "A finished image is ready to review.",
            href,
            action: "Review result",
            source: "result",
          })
        }
      }
    }
  }

  const counts = Object.fromEntries(
    LISTING_STATUS_ORDER.map((status) => [status, items.filter((item) => item.status === status).length])
  ) as Record<ListingStatusKey, number>
  const total = items.length
  const active = counts.uploading + counts.organizing + counts.queued + counts.editing
  const headline = counts.needs_attention
    ? "Needs attention"
    : active
      ? "In progress"
      : counts.review_pending
        ? "Review pending"
        : "No active work"

  return { counts, items, total, headline }
}
