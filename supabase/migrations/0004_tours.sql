-- Phase 12: VIRTUAL_TOUR — tours + equirectangular scenes with hotspots.

create table tours (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  title text not null default 'Virtual tour',
  slug text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

create table tour_scenes (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references tours(id) on delete cascade,
  name text not null,
  storage_path text not null,
  width int not null,
  order_index int not null default 0,
  initial_yaw double precision not null default 0,
  -- [{ yaw, pitch, target (scene id), label }]
  hotspots jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table tours enable row level security;
alter table tour_scenes enable row level security;

create policy "own tours" on tours for all
  using (exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()));

create policy "own tour_scenes" on tour_scenes for all
  using (exists (
    select 1 from tours t join listings l on l.id = t.listing_id
    where t.id = tour_id and l.user_id = auth.uid()
  ));
