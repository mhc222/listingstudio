import type { Metadata } from "next"
import { TermsBody } from "@/components/terms-body"
import { Wordmark } from "@/components/brand"

export const metadata: Metadata = {
  title: "Terms of Use — Listing Studio",
}

// Public page (middleware exempts /terms) — readable while signed out.
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8">
        <Wordmark />
      </div>
      <h1 className="mb-6 text-2xl font-semibold">Terms of Use</h1>
      <TermsBody />
    </main>
  )
}
