"use client"

import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Dialog } from "radix-ui"
import { Button } from "@/components/ui/button"
import { TermsBody } from "@/components/terms-body"

// Blocking Terms of Use gate. Rendered by the root layout only when the
// signed-in user has not accepted the current TERMS_VERSION; unmounts after
// router.refresh() re-runs the layout's acceptance check.
export function TermsGate() {
  const pathname = usePathname()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The terms themselves must stay readable at /terms.
  if (pathname === "/terms" || pathname === "/login") return null

  async function agree() {
    setBusy(true)
    setError(null)
    const res = await fetch("/api/terms/accept", { method: "POST" })
    if (!res.ok) {
      setError("Could not record acceptance — try again.")
      setBusy(false)
      return
    }
    router.refresh()
  }

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border bg-card text-card-foreground shadow-lg"
        >
          <div className="border-b px-6 py-4">
            <Dialog.Title className="font-mono text-base font-semibold uppercase tracking-wide">
              Terms of Use
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              Please review and accept our terms to start using Listing Studio.
              Also available anytime at{" "}
              <a href="/terms" target="_blank" className="underline">
                /terms
              </a>
              .
            </Dialog.Description>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <TermsBody />
          </div>
          <div className="border-t px-6 py-4">
            <p className="mb-3 text-xs text-muted-foreground">
              By clicking &quot;I Agree&quot; you confirm you have read and
              accept the Terms of Use, including that you are solely
              responsible for the content you upload and how you use the
              results. Your acceptance is recorded against your account.
            </p>
            {error && (
              <p className="mb-3 text-xs text-destructive">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="outline" disabled={busy}>
                  Decline &amp; sign out
                </Button>
              </form>
              <Button onClick={agree} disabled={busy}>
                {busy ? "Recording…" : "I Agree"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
