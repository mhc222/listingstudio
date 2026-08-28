-- Listing Studio full schema. Multi-user-ready (user_id on root tables), single-user app.

create type room_type as enum (
  'living_room', 'kitchen', 'dining', 'main_bedroom', 'bedroom_2', 'bedroom_3',
  'bedroom_4', 'bathroom_ensuite', 'office', 'outdoor_patio', 'other'
);
create type job_status as enum ('pending', 'processing', 'complete', 'failed');

create table listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  address text not null,
  mls_number text,
  created_at timestamptz not null default now()
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  name text not null,
  room_type room_type not null default 'other',
  length numeric,
  width numeric,
  ceiling_height numeric,
  units text not null default 'ft' check (units in ('ft', 'm')),
  notes text
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  room_id uuid references rooms(id) on delete set null,
  storage_path text not null,
  width int,
  height int,
  is_floor_plan boolean not null default false,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  title text not null,
  status job_status not null default 'pending',
  kind text not null default 'normal' check (kind in ('normal', 'ideas')),
  grounding_used jsonb,
  total_cost_cents int not null default 0,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table sample_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  storage_path text not null,
  label text,
  use_count int not null default 0,
  created_at timestamptz not null default now()
);

create table file_groups (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  primary_photo_id uuid not null references photos(id),
  -- ordered [{edit_type, options}]; each step's output feeds the next
  edit_chain jsonb not null,
  comment text,
  size_preset text not null default 'original' check (size_preset in ('original', 'under_10mb', 'under_5mb')),
  provider text,
  -- state machine (see CLAUDE.md job orchestration)
  current_step int not null default 0,
  step_status text not null default 'queued' check (step_status in ('queued', 'running', 'complete', 'failed')),
  fal_request_id text,
  step_started_at timestamptz,
  created_at timestamptz not null default now()
);

create table file_group_refs (
  id uuid primary key default gen_random_uuid(),
  file_group_id uuid not null references file_groups(id) on delete cascade,
  photo_id uuid references photos(id) on delete cascade,
  sample_image_id uuid references sample_images(id) on delete cascade,
  check (num_nonnulls(photo_id, sample_image_id) = 1)
);

create table output_versions (
  id uuid primary key default gen_random_uuid(),
  file_group_id uuid not null references file_groups(id) on delete cascade,
  version_number int not null,
  parent_version_id uuid references output_versions(id),
  storage_path text not null,
  qa_note text,
  created_at timestamptz not null default now(),
  unique (file_group_id, version_number)
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  file_group_id uuid not null references file_groups(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table spend_ledger (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete set null,
  file_group_id uuid references file_groups(id) on delete set null,
  edit_type text,
  model text not null,
  cost_cents numeric not null,
  kind text not null check (kind in ('generation', 'rework', 'qa', 'upscale', 'ideas', 'interpreter')),
  created_at timestamptz not null default now()
);

create index photos_listing_idx on photos(listing_id);
create index rooms_listing_idx on rooms(listing_id);
create index jobs_listing_idx on jobs(listing_id);
create index file_groups_job_idx on file_groups(job_id);
create index output_versions_fg_idx on output_versions(file_group_id);
create index chat_messages_fg_idx on chat_messages(file_group_id);
create index spend_ledger_job_idx on spend_ledger(job_id);

-- RLS: ownership rooted at listings.user_id / sample_images.user_id
alter table listings enable row level security;
alter table rooms enable row level security;
alter table photos enable row level security;
alter table jobs enable row level security;
alter table file_groups enable row level security;
alter table file_group_refs enable row level security;
alter table output_versions enable row level security;
alter table sample_images enable row level security;
alter table chat_messages enable row level security;
alter table spend_ledger enable row level security;

create policy "own listings" on listings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own sample_images" on sample_images for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own rooms" on rooms for all
  using (exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()));

create policy "own photos" on photos for all
  using (exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()));

create policy "own jobs" on jobs for all
  using (exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()));

create policy "own file_groups" on file_groups for all
  using (exists (
    select 1 from jobs j join listings l on l.id = j.listing_id
    where j.id = job_id and l.user_id = auth.uid()
  ));

create policy "own file_group_refs" on file_group_refs for all
  using (exists (
    select 1 from file_groups fg
    join jobs j on j.id = fg.job_id
    join listings l on l.id = j.listing_id
    where fg.id = file_group_id and l.user_id = auth.uid()
  ));

create policy "own output_versions" on output_versions for all
  using (exists (
    select 1 from file_groups fg
    join jobs j on j.id = fg.job_id
    join listings l on l.id = j.listing_id
    where fg.id = file_group_id and l.user_id = auth.uid()
  ));

create policy "own chat_messages" on chat_messages for all
  using (exists (
    select 1 from file_groups fg
    join jobs j on j.id = fg.job_id
    join listings l on l.id = j.listing_id
    where fg.id = file_group_id and l.user_id = auth.uid()
  ));

create policy "own spend_ledger" on spend_ledger for all
  using (exists (select 1 from jobs j join listings l on l.id = j.listing_id
    where j.id = job_id and l.user_id = auth.uid()));

-- Storage buckets: originals (immutable), outputs (versioned paths), references
insert into storage.buckets (id, name, public) values
  ('originals', 'originals', false),
  ('outputs', 'outputs', false),
  ('references', 'references', false);

create policy "authenticated read app buckets" on storage.objects for select
  to authenticated using (bucket_id in ('originals', 'outputs', 'references'));

create policy "authenticated insert app buckets" on storage.objects for insert
  to authenticated with check (bucket_id in ('originals', 'outputs', 'references'));

-- originals are immutable: update/delete only on outputs and references
create policy "authenticated update mutable buckets" on storage.objects for update
  to authenticated using (bucket_id in ('outputs', 'references'));

create policy "authenticated delete mutable buckets" on storage.objects for delete
  to authenticated using (bucket_id in ('outputs', 'references'));
