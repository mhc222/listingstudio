-- Phase 21: MLS compliance checker. Per-version compliance checklist stored as
-- jsonb: { checked_at, checks: [{ id, label, pass, note? }] }. Flag-only —
-- compliance never blocks delivery. RLS already covers output_versions.
alter table output_versions add column if not exists compliance jsonb;
