"use client"

import { UploadQueue } from "./upload-queue"

export function UploadPanel({ listingId }: { listingId: string }) {
  return <UploadQueue listingId={listingId} />
}
