-- Phase 19: Listing video reels (Tier A Ken Burns slideshow).

create table reels (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'rendering', 'complete', 'failed')),
  format text not null default '9:16' check (format in ('9:16', '16:9')),
  -- ordered render sources: [{ bucket, path }]
  clips jsonb not null,
  -- filename inside assets/music, null = no audio track
  music text,
  -- [address_line, facts_line] overlay text (facts_line optional)
  caption jsonb not null default '[]'::jsonb,
  storage_path text,
  error text,
  started_at timestamptz,
  created_at timestamptz not null default now()
);

create index reels_listing_idx on reels(listing_id);
create index reels_status_idx on reels(status);

alter table reels enable row level security;

create policy "own reels" on reels for all
  using (exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()));

alter publication supabase_realtime add table reels;
