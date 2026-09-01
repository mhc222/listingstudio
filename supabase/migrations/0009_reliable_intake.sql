-- Phase 43: secure resumable-intake contract.
-- Raw uploaded bytes remain immutable; photos.storage_path points at the
-- canonical browser/model-safe object while source_storage_path points at the
-- exact uploaded bytes.

alter table photos
  add column source_storage_path text,
  add column source_content_type text,
  add column source_byte_size bigint,
  add column original_filename text;

update photos
set source_storage_path = storage_path
where source_storage_path is null;

alter table photos
  alter column source_storage_path set not null;

create table upload_batches (
  id uuid primary key,
  listing_id uuid not null references listings(id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'complete', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table upload_items (
  id uuid primary key,
  batch_id uuid not null references upload_batches(id) on delete cascade,
  photo_id uuid not null unique,
  room_id uuid references rooms(id) on delete set null,
  original_filename text not null,
  declared_content_type text not null,
  declared_byte_size bigint not null check (declared_byte_size > 0 and declared_byte_size <= 52428800),
  source_extension text not null check (source_extension in ('jpg', 'png', 'webp', 'heic', 'heif', 'pdf')),
  is_floor_plan boolean not null default false,
  intake_path text not null unique,
  source_storage_path text not null unique,
  canonical_storage_path text,
  source_content_type text,
  canonical_content_type text,
  source_byte_size bigint,
  width int,
  height int,
  status text not null default 'reserved'
    check (status in ('reserved', 'finalizing', 'complete', 'failed', 'canceled')),
  error text,
  finalized_at timestamptz,
  intake_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table photos
  add column upload_item_id uuid unique references upload_items(id) on delete set null;

create index upload_batches_listing_idx on upload_batches(listing_id, created_at desc);
create index upload_items_batch_idx on upload_items(batch_id, created_at);
create index upload_items_status_idx on upload_items(status) where status <> 'complete';

alter table upload_batches enable row level security;
alter table upload_items enable row level security;

create policy "read own upload batches" on upload_batches for select to authenticated
  using (exists (
    select 1 from listings l
    where l.id = listing_id and l.user_id = auth.uid()
  ));

create policy "read own upload items" on upload_items for select to authenticated
  using (exists (
    select 1
    from upload_batches b
    join listings l on l.id = b.listing_id
    where b.id = batch_id and l.user_id = auth.uid()
  ));

-- Atomic Postgres half of finalization. Storage writes happen first at
-- deterministic immutable paths; this function makes retries converge on one
-- photos row and one completed upload item.
create or replace function finalize_upload_item(
  p_item_id uuid,
  p_source_storage_path text,
  p_canonical_storage_path text,
  p_source_content_type text,
  p_canonical_content_type text,
  p_source_byte_size bigint,
  p_width int,
  p_height int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item upload_items%rowtype;
  v_listing_id uuid;
  v_user_id uuid;
  v_existing photos%rowtype;
  v_prefix text;
begin
  select i.*
  into v_item
  from upload_items i
  join upload_batches b on b.id = i.batch_id
  join listings l on l.id = b.listing_id
  where i.id = p_item_id and l.user_id = auth.uid()
  for update of i;

  if not found then
    raise exception 'upload item not found' using errcode = 'P0002';
  end if;

  select b.listing_id, l.user_id
  into v_listing_id, v_user_id
  from upload_batches b
  join listings l on l.id = b.listing_id
  where b.id = v_item.batch_id;

  if v_item.status = 'canceled' then
    raise exception 'upload item canceled' using errcode = '22023';
  end if;

  v_prefix := auth.uid()::text || '/' || v_listing_id::text || '/' || v_item.photo_id::text || '/';
  if p_source_storage_path <> v_item.source_storage_path
     or p_source_storage_path not like v_prefix || 'source.%'
     or not (
       p_canonical_storage_path = p_source_storage_path
       or p_canonical_storage_path like v_prefix || 'canonical.%'
     ) then
    raise exception 'invalid final storage path' using errcode = '22023';
  end if;

  select * into v_existing from photos where id = v_item.photo_id;
  if found and (
    v_existing.upload_item_id is distinct from v_item.id
    or v_existing.listing_id is distinct from v_listing_id
    or v_existing.source_storage_path is distinct from p_source_storage_path
    or v_existing.storage_path is distinct from p_canonical_storage_path
  ) then
    raise exception 'photo id conflict' using errcode = '23505';
  end if;

  if not found then
    insert into photos (
      id,
      listing_id,
      room_id,
      storage_path,
      source_storage_path,
      source_content_type,
      source_byte_size,
      original_filename,
      width,
      height,
      is_floor_plan,
      upload_item_id
    ) values (
      v_item.photo_id,
      v_listing_id,
      v_item.room_id,
      p_canonical_storage_path,
      p_source_storage_path,
      p_source_content_type,
      p_source_byte_size,
      v_item.original_filename,
      p_width,
      p_height,
      v_item.is_floor_plan,
      v_item.id
    );
  end if;

  update upload_items
  set status = 'complete',
      canonical_storage_path = p_canonical_storage_path,
      source_content_type = p_source_content_type,
      canonical_content_type = p_canonical_content_type,
      source_byte_size = p_source_byte_size,
      width = p_width,
      height = p_height,
      error = null,
      finalized_at = coalesce(finalized_at, now()),
      updated_at = now()
  where id = p_item_id;

  if not exists (
    select 1 from upload_items
    where batch_id = v_item.batch_id and status not in ('complete', 'canceled')
  ) then
    update upload_batches
    set status = 'complete', updated_at = now()
    where id = v_item.batch_id;
  end if;

  return v_item.photo_id;
end;
$$;

revoke all on function finalize_upload_item(uuid, text, text, text, text, bigint, int, int) from public;
grant execute on function finalize_upload_item(uuid, text, text, text, text, bigint, int, int) to authenticated;

-- A mutable staging bucket for direct/resumable transfer. Completed source and
-- canonical objects are copied into immutable originals paths.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'intake',
  'intake',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Replace the original bucket-wide authenticated policies. Every current app
-- object path begins with the owning user's UUID; admin/service writes bypass
-- RLS but remain readable by that user's path.
drop policy if exists "authenticated read app buckets" on storage.objects;
drop policy if exists "authenticated insert app buckets" on storage.objects;
drop policy if exists "authenticated update mutable buckets" on storage.objects;
drop policy if exists "authenticated delete mutable buckets" on storage.objects;

create policy "read own app objects" on storage.objects for select to authenticated
  using (
    bucket_id in ('originals', 'outputs', 'references', 'intake')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "insert own app objects" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('originals', 'outputs', 'references', 'intake')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "update own mutable app objects" on storage.objects for update to authenticated
  using (
    bucket_id in ('outputs', 'references', 'intake')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('outputs', 'references', 'intake')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own mutable app objects" on storage.objects for delete to authenticated
  using (
    bucket_id in ('outputs', 'references', 'intake')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
