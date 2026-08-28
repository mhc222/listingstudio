# DECISIONS.md — one line each

- 2026-08-28: Nested git repo inside home monorepo (like damdaryl app/) since brief says "init git repo" and this dir sits under the /Users/mattcronin repo.
- 2026-08-28: Full schema lands in Phase 1 (one migration) so later phases never block on migrations; edit_chain stored as ordered jsonb on file_groups rather than a join table — single-user tool, simpler reads.
- 2026-08-28: State machine fields live on file_groups (current_step, step_status, fal_request_id) instead of a separate steps table; revisit only if chains outgrow it (then log + propose Inngest/Trigger.dev per brief).
- 2026-08-28: MLS size presets applied at download time via sharp, not stored as extra objects — storage stays lean, presets are cheap to recompute.
- 2026-08-28: Supabase project created manually by Matt in org zzbpawcjzxujqxustqup (us-west-2), not via MCP in the DarylV3 org — PROGRESS.md's planned org/region superseded.
- 2026-08-28: HEIC decode via `heic-convert` (wasm libheif), not sharp — sharp prebuilt binaries exclude patent-encumbered HEIC; sharp still does dimension extraction and later resizing.
- 2026-08-28: PDF floor plans stored as-is with null dimensions and rendered as a link, not thumbnailed — avoids a PDF-render dependency for a single-user nicety.
- 2026-08-28: Photo grid uses plain `<img>` with signed URLs (1h expiry), not next/image — the optimizer caching signed URLs that expire causes broken images.
