# DECISIONS.md — one line each

- 2026-08-28: Nested git repo inside home monorepo (like damdaryl app/) since brief says "init git repo" and this dir sits under the /Users/mattcronin repo.
- 2026-08-28: Full schema lands in Phase 1 (one migration) so later phases never block on migrations; edit_chain stored as ordered jsonb on file_groups rather than a join table — single-user tool, simpler reads.
- 2026-08-28: State machine fields live on file_groups (current_step, step_status, fal_request_id) instead of a separate steps table; revisit only if chains outgrow it (then log + propose Inngest/Trigger.dev per brief).
- 2026-08-28: MLS size presets applied at download time via sharp, not stored as extra objects — storage stays lean, presets are cheap to recompute.
- 2026-08-28: Supabase project created manually by Matt in org zzbpawcjzxujqxustqup (us-west-2), not via MCP in the DarylV3 org — PROGRESS.md's planned org/region superseded.
- 2026-08-28: HEIC decode via `heic-convert` (wasm libheif), not sharp — sharp prebuilt binaries exclude patent-encumbered HEIC; sharp still does dimension extraction and later resizing.
- 2026-08-28: PDF floor plans stored as-is with null dimensions and rendered as a link, not thumbnailed — avoids a PDF-render dependency for a single-user nicety.
- 2026-08-28: Photo grid uses plain `<img>` with signed URLs (1h expiry), not next/image — the optimizer caching signed URLs that expire causes broken images.
- 2026-08-28: fal called via raw fetch against the queue API, no @fal-ai/client dep — three endpoints, one auth header.
- 2026-08-28: Webhook auth = fal's ED25519 signature verified against their JWKS (node:crypto, fail closed, 5-min replay window); FAL_WEBHOOK_SECRET dropped from .env.example — fal has no shared-secret scheme.
- 2026-08-28: Local dev has no reachable webhook URL, so reconcile route doubles as the completion poller (`?all=1` ignores the 3-min cutoff); webhook param only sent when NEXT_PUBLIC_APP_URL is non-localhost.
- 2026-08-28: Generation-error auto-retry tracked via retry_count column (migration 0002), one retry then failed + re-run button; step outputs stored at deterministic path {fg}/step-{n}-r{retry} so duplicate completions upsert instead of duplicating objects.
- 2026-08-28: jobs.total_cost_cents widened to numeric (rates are fractional cents); incremented via security-definer rpc since supabase-js can't do relative updates.
- 2026-08-28: Parked idea (from flippin.ai scan): 5-sec before/after transformation video per output (one fal image-to-video call) as a social artifact — consider post-phase-10; no prompt reverse-engineering needed, their catalog is a subset of ours.
- 2026-08-28: Chained-step input resolved by listing outputs/{fg}/ for the newest step-{n-1}-r* object, not by computing the path from retry_count — the retry counter is per-group, so a retry on step N would otherwise point at a nonexistent previous-step path.
- 2026-08-28: Size presets enforced as a descending-JPEG-quality ladder (90→40) in the download route, no resizing — resolution-based MLS presets arrive with the phase 10 download menu.
