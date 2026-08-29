-- Phase 13: COPYWRITING — persisted listing copy per tone + ledger kind.

create table listing_copy (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  tone text not null check (tone in ('luxury', 'family', 'investor')),
  -- { beds, baths, sqft, features }
  facts jsonb not null default '{}'::jsonb,
  headline text not null default '',
  desc_100 text not null default '',
  desc_250 text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, tone)
);

alter table listing_copy enable row level security;

create policy "own listing_copy" on listing_copy for all
  using (exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()));

alter table spend_ledger drop constraint spend_ledger_kind_check;
alter table spend_ledger add constraint spend_ledger_kind_check
  check (kind in ('generation', 'rework', 'qa', 'upscale', 'ideas', 'interpreter', 'copywriting'));
