"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import type { DeliveryPreview, DeliveryProfileRow } from "@/lib/delivery"

type ProfileForm = {
  name: string
  fileFormat: string
  maxWidth: string
  maxHeight: string
  quality: string
  maxMegabytes: string
  disclosureMode: string
  namingPattern: string
  ordering: string
}

const NEW_PROFILE: ProfileForm = {
  name: "MLS delivery",
  fileFormat: "jpeg",
  maxWidth: "3000",
  maxHeight: "3000",
  quality: "88",
  maxMegabytes: "10",
  disclosureMode: "watermark",
  namingPattern: "sequence_room",
  ordering: "shoot",
}

function formFromProfile(profile: DeliveryProfileRow): ProfileForm {
  return {
    name: profile.name,
    fileFormat: profile.file_format,
    maxWidth: profile.max_width?.toString() ?? "",
    maxHeight: profile.max_height?.toString() ?? "",
    quality: profile.quality.toString(),
    maxMegabytes: profile.max_bytes ? String(Number((profile.max_bytes / 1024 / 1024).toFixed(2))) : "",
    disclosureMode: profile.disclosure_mode,
    namingPattern: profile.naming_pattern,
    ordering: profile.ordering,
  }
}

function profileSummary(profile: DeliveryProfileRow) {
  const dimensions = profile.max_width || profile.max_height
    ? `${profile.max_width ?? "auto"} × ${profile.max_height ?? "auto"} px`
    : "Original dimensions"
  const ceiling = profile.max_bytes ? ` · ≤ ${(profile.max_bytes / 1024 / 1024).toFixed(profile.max_bytes % (1024 * 1024) ? 2 : 0)} MB` : ""
  return `${profile.file_format.toUpperCase()} · ${dimensions}${ceiling}`
}

export function DeliveryWorkspace({ listingId, address }: { listingId: string; address: string }) {
  const [profiles, setProfiles] = useState<DeliveryProfileRow[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [preview, setPreview] = useState<DeliveryPreview | null>(null)
  const [profileForm, setProfileForm] = useState<ProfileForm>(NEW_PROFILE)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProfiles = useCallback(async (preferId?: string) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/delivery-profiles", { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? "Could not load delivery profiles.")
      const next = (data?.profiles ?? []) as DeliveryProfileRow[]
      setProfiles(next)
      setSelectedId((current) => {
        const wanted = preferId || current
        return next.some((profile) => profile.id === wanted) ? wanted : next[0]?.id ?? ""
      })
      if (next.length === 0) setShowForm(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load delivery profiles.")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPreview = useCallback(async (profileId: string) => {
    if (!profileId) { setPreview(null); return }
    setLoading(true)
    setError(null)
    setAcknowledged(false)
    try {
      const response = await fetch(`/api/listings/${listingId}/delivery?profileId=${encodeURIComponent(profileId)}`, { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? "Could not prepare the package preview.")
      setPreview(data.preview as DeliveryPreview)
    } catch (cause) {
      setPreview(null)
      setError(cause instanceof Error ? cause.message : "Could not prepare the package preview.")
    } finally {
      setLoading(false)
    }
  }, [listingId])

  useEffect(() => { void loadProfiles() }, [loadProfiles])
  useEffect(() => { if (selectedId) void loadPreview(selectedId) }, [loadPreview, selectedId])

  function setField<K extends keyof ProfileForm>(field: K, value: ProfileForm[K]) {
    setProfileForm((current) => ({ ...current, [field]: value }))
  }

  async function saveProfile() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(editingId ? `/api/delivery-profiles/${editingId}` : "/api/delivery-profiles", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileForm),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? "Could not save the delivery profile.")
      const saved = data.profile as DeliveryProfileRow
      setShowForm(false)
      setEditingId(null)
      setProfileForm(NEW_PROFILE)
      await loadProfiles(saved.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the delivery profile.")
    } finally {
      setBusy(false)
    }
  }

  async function deleteProfile() {
    if (!selectedId || busy || !window.confirm("Delete this delivery profile? Approved finals will not change.")) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/delivery-profiles/${selectedId}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? "Could not delete the delivery profile.")
      setSelectedId("")
      setPreview(null)
      await loadProfiles()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the delivery profile.")
    } finally {
      setBusy(false)
    }
  }

  const selectedProfile = profiles.find((profile) => profile.id === selectedId) ?? null
  const mayDownload = Boolean(preview?.canDownload && (preview.warnings.length === 0 || acknowledged))
  const downloadHref = preview
    ? `/api/listings/${listingId}/download-all?profileId=${encodeURIComponent(preview.profile.id)}&fingerprint=${preview.fingerprint}${preview.warnings.length ? `&acknowledge=${preview.fingerprint}` : ""}`
    : "#"

  return (
    <section aria-label="Approved-finals delivery workspace" className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="ls-surface p-4 sm:p-5 lg:sticky lg:top-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="ls-section-label text-muted-foreground">Output recipe</p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">Delivery profile</h2>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setProfileForm(NEW_PROFILE); setShowForm(true) }}>New</Button>
        </div>

        {profiles.length > 0 && (
          <div className="mt-4">
            <label htmlFor="delivery-profile" className="text-xs font-semibold">Saved profile</label>
            <Select id="delivery-profile" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="mt-2">
              {profiles.map((profile) => <option key={profile.id} value={profile.id} data-description={profileSummary(profile)}>{profile.name}</option>)}
            </Select>
            {selectedProfile && <p className="mt-2 text-xs text-muted-foreground">{profileSummary(selectedProfile)}</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { if (!selectedProfile) return; setEditingId(selectedProfile.id); setProfileForm(formFromProfile(selectedProfile)); setShowForm(true) }}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={deleteProfile} disabled={busy}>Delete</Button>
            </div>
          </div>
        )}

        {showForm && (
          <div className="mt-5 grid gap-3 border-t border-border/60 pt-4">
            <div>
              <label htmlFor="profile-name" className="text-xs font-semibold">Profile name</label>
              <Input id="profile-name" value={profileForm.name} maxLength={80} onChange={(event) => setField("name", event.target.value)} className="mt-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label htmlFor="profile-format" className="text-xs font-semibold">Format</label><Select id="profile-format" value={profileForm.fileFormat} onChange={(event) => setProfileForm((current) => ({ ...current, fileFormat: event.target.value, maxMegabytes: event.target.value === "png" ? "" : current.maxMegabytes }))} className="mt-1.5"><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="png">PNG</option></Select></div>
              <div><label htmlFor="profile-quality" className="text-xs font-semibold">Quality</label><Input id="profile-quality" type="number" min="35" max="100" value={profileForm.quality} onChange={(event) => setField("quality", event.target.value)} className="mt-1.5" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label htmlFor="profile-width" className="text-xs font-semibold">Max width</label><Input id="profile-width" type="number" min="320" max="12000" value={profileForm.maxWidth} onChange={(event) => setField("maxWidth", event.target.value)} className="mt-1.5" /></div>
              <div><label htmlFor="profile-height" className="text-xs font-semibold">Max height</label><Input id="profile-height" type="number" min="320" max="12000" value={profileForm.maxHeight} onChange={(event) => setField("maxHeight", event.target.value)} className="mt-1.5" /></div>
            </div>
            <div><label htmlFor="profile-size" className="text-xs font-semibold">Size ceiling in MB <span className="font-normal text-muted-foreground">Optional</span></label><Input id="profile-size" type="number" min="0.25" max="20" step="0.25" value={profileForm.maxMegabytes} onChange={(event) => setField("maxMegabytes", event.target.value)} className="mt-1.5" /></div>
            <div><label htmlFor="profile-disclosure" className="text-xs font-semibold">Virtual staging disclosure</label><Select id="profile-disclosure" value={profileForm.disclosureMode} onChange={(event) => setField("disclosureMode", event.target.value)} className="mt-1.5"><option value="watermark">Watermark</option><option value="companion">Companion text file</option><option value="watermark_and_companion">Watermark + companion</option></Select></div>
            <div><label htmlFor="profile-naming" className="text-xs font-semibold">Filenames</label><Select id="profile-naming" value={profileForm.namingPattern} onChange={(event) => setField("namingPattern", event.target.value)} className="mt-1.5"><option value="sequence_room">Sequence + room</option><option value="sequence_original">Sequence + original name</option><option value="original">Preserve original name</option></Select></div>
            <div><label htmlFor="profile-order" className="text-xs font-semibold">Order</label><Select id="profile-order" value={profileForm.ordering} onChange={(event) => setField("ordering", event.target.value)} className="mt-1.5"><option value="shoot">Shoot order</option><option value="room">Room, then shoot order</option></Select></div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveProfile} disabled={busy}>{busy ? "Saving…" : editingId ? "Update profile" : "Save profile"}</Button>
              {profiles.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setEditingId(null) }}>Cancel</Button>}
            </div>
          </div>
        )}
      </aside>

      <div className="min-w-0">
        <div className="ls-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="ls-section-label text-muted-foreground">Package preview</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{address}</h2>
              {preview && <p className="mt-1 text-sm text-muted-foreground">{preview.included.length} included · {preview.omitted.length} omitted · {preview.warnings.length} warning{preview.warnings.length === 1 ? "" : "s"}</p>}
            </div>
            <Button size="sm" variant="outline" onClick={() => selectedId && loadPreview(selectedId)} disabled={!selectedId || loading}>Refresh preview</Button>
          </div>

          {loading && !preview && <p className="mt-6 text-sm text-muted-foreground">Preparing exact approved selections…</p>}
          {!loading && profiles.length === 0 && <p className="mt-6 text-sm text-muted-foreground">Save a profile to preview this package. The starter values are a practical MLS-sized JPEG recipe.</p>}

          {preview && (
            <>
              {preview.blockingIssues.length > 0 && (
                <div role="alert" className="mt-5 border-l-2 border-destructive pl-3">
                  <p className="text-sm font-semibold">Package blocked</p>
                  {preview.blockingIssues.map((issue) => <p key={issue} className="mt-1 text-sm text-muted-foreground">{issue}</p>)}
                </div>
              )}
              {preview.omitted.length > 0 && (
                <div className="mt-5 rounded-xl bg-muted/55 p-3">
                  <p className="text-sm font-semibold">Missing finals</p>
                  <div className="mt-2 grid gap-1.5">
                    {preview.omitted.map((item) => <Link key={item.sourcePhotoId} href={`/listings/${listingId}/proofing?photo=${item.sourcePhotoId}`} className="text-sm underline underline-offset-4">{item.originalFilename} · Approve in Proofing →</Link>)}
                  </div>
                </div>
              )}
              {preview.warnings.length > 0 && (
                <div className="mt-5 rounded-xl border border-border/80 p-3">
                  <p className="text-sm font-semibold">QA and compliance warnings</p>
                  {preview.warnings.map((warning) => <p key={warning.id} className="mt-1 text-sm text-muted-foreground"><span className="font-medium text-foreground">{warning.filename}:</span> {warning.message}</p>)}
                  <label className="mt-3 flex min-h-10 cursor-pointer items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 size-4" /><span>I reviewed these warnings and want to create this package.</span></label>
                </div>
              )}
            </>
          )}
          {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        </div>

        {preview && preview.included.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-card">
            <div className="hidden grid-cols-[3rem_minmax(9rem,1fr)_minmax(10rem,1.2fr)_minmax(8rem,1fr)] gap-3 border-b border-border/60 px-4 py-3 text-xs font-semibold text-muted-foreground sm:grid">
              <span>Order</span><span>Approved source</span><span>Generated file</span><span>Output</span>
            </div>
            {preview.included.map((item) => (
              <div key={item.sourcePhotoId} className="grid gap-2 border-b border-border/50 px-4 py-3 last:border-b-0 sm:grid-cols-[3rem_minmax(9rem,1fr)_minmax(10rem,1.2fr)_minmax(8rem,1fr)] sm:gap-3">
                <span className="text-xs font-semibold text-muted-foreground">{String(item.order).padStart(3, "0")}</span>
                <div className="min-w-0"><p className="truncate text-sm font-medium">{item.originalFilename}</p><p className="text-xs text-muted-foreground">{item.roomName} · {item.source} · {item.version}</p></div>
                <p className="break-all text-sm">{item.generatedFilename}</p>
                <div className="text-xs text-muted-foreground"><p>{item.expectedDimensions}</p><p>{item.expectedSize}</p><p>{item.stagedDisclosure}</p></div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="max-w-xl text-xs text-muted-foreground">The server rechecks the profile and every approved final when download begins. A changed final forces a fresh preview.</p>
          {mayDownload ? <Button asChild><a href={downloadHref}>Download approved package</a></Button> : <Button disabled>Download approved package</Button>}
        </div>
      </div>
    </section>
  )
}
