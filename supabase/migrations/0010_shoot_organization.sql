-- Phase 45: source inventory, HDR bracket proposals, and logical-photo identity.

alter table upload_items add column intake_order int;

with ranked as (
  select id, row_number() over (partition by batch_id order by created_at, id)::int as position
  from upload_items
)
update upload_items i set intake_order = ranked.position
from ranked where ranked.id = i.id;

alter table upload_items alter column intake_order set not null;

alter table photos
  add column source_batch_id uuid references upload_batches(id) on delete set null,
  add column intake_order int,
  add column captured_at timestamptz,
  add column exposure_time_seconds numeric,
  add column exposure_bias_ev numeric,
  add column aperture_f_number numeric,
  add column iso int,
  add column focal_length_mm numeric,
  add column camera_make text,
  add column camera_model text,
  add column lens_model text,
  add column source_metadata jsonb not null default '{}'::jsonb,
  add column photo_role text not null default 'source'
    check (photo_role in ('source', 'hdr_merged')),
  add column hdr_group_id uuid,
  add column hdr_decision text not null default 'unreviewed'
    check (hdr_decision in ('unreviewed', 'single'));

update photos p
set source_batch_id = i.batch_id,
    intake_order = i.intake_order
from upload_items i
where i.id = p.upload_item_id;

with ranked as (
  select id, row_number() over (partition by listing_id order by created_at, id)::int as position
  from photos
  where intake_order is null
)
update photos p set intake_order = ranked.position
from ranked where ranked.id = p.id;

create table photo_groups (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  kind text not null default 'hdr_bracket' check (kind = 'hdr_bracket'),
  state text not null default 'proposed'
    check (state in ('proposed', 'confirmed', 'dismissed')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  reason text not null,
  representative_photo_id uuid references photos(id) on delete set null,
  merge_photo_id uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table photo_group_members (
  group_id uuid not null references photo_groups(id) on delete cascade,
  photo_id uuid not null unique references photos(id) on delete restrict,
  position int not null check (position > 0),
  primary key (group_id, photo_id),
  unique (group_id, position)
);

alter table photos
  add constraint photos_hdr_group_fk
  foreign key (hdr_group_id) references photo_groups(id) on delete set null;

create index photos_shoot_order_idx
  on photos(listing_id, source_batch_id, intake_order, created_at);
create index photos_hdr_group_idx on photos(hdr_group_id) where hdr_group_id is not null;
create index photo_groups_listing_idx on photo_groups(listing_id, state, created_at);
create index photo_group_members_group_idx on photo_group_members(group_id, position);

alter table photo_groups enable row level security;
alter table photo_group_members enable row level security;

create policy "own photo groups" on photo_groups for all to authenticated
  using (exists (
    select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
  ));

create policy "own photo group members" on photo_group_members for all to authenticated
  using (exists (
    select 1 from photo_groups g
    join listings l on l.id = g.listing_id
    where g.id = group_id and l.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from photo_groups g
    join listings l on l.id = g.listing_id
    where g.id = group_id and l.user_id = auth.uid()
  ));

alter publication supabase_realtime add table photo_groups, photo_group_members;

-- Phase 43's finalizer extended with the metadata extracted from the immutable
-- source at finalization time. The old overload remains for migration rollback
-- compatibility; Phase 45 application code calls this signature.
create or replace function finalize_upload_item(
  p_item_id uuid,
  p_user_id uuid,
  p_source_storage_path text,
  p_canonical_storage_path text,
  p_source_content_type text,
  p_canonical_content_type text,
  p_source_byte_size bigint,
  p_width int,
  p_height int,
  p_captured_at timestamptz,
  p_exposure_time_seconds numeric,
  p_exposure_bias_ev numeric,
  p_aperture_f_number numeric,
  p_iso int,
  p_focal_length_mm numeric,
  p_camera_make text,
  p_camera_model text,
  p_lens_model text,
  p_source_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item upload_items%rowtype;
  v_listing_id uuid;
  v_existing photos%rowtype;
  v_prefix text;
begin
  select i.* into v_item
  from upload_items i
  join upload_batches b on b.id = i.batch_id
  join listings l on l.id = b.listing_id
  where i.id = p_item_id and l.user_id = p_user_id
  for update of i;

  if not found then raise exception 'upload item not found' using errcode = 'P0002'; end if;
  select b.listing_id into v_listing_id from upload_batches b where b.id = v_item.batch_id;
  if v_item.status = 'canceled' then raise exception 'upload item canceled' using errcode = '22023'; end if;
  if v_item.status not in ('finalizing', 'complete') then
    raise exception 'upload item is not ready to finalize' using errcode = '55000';
  end if;
  if p_source_byte_size <> v_item.declared_byte_size or p_source_byte_size <= 0 or p_source_byte_size > 52428800 then
    raise exception 'invalid source byte size' using errcode = '22023';
  end if;
  if not (
    p_source_content_type = v_item.declared_content_type
    or (p_source_content_type in ('image/heic', 'image/heif') and v_item.declared_content_type in ('image/heic', 'image/heif'))
  ) then raise exception 'invalid source content type' using errcode = '22023'; end if;
  if p_canonical_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'invalid canonical content type' using errcode = '22023';
  end if;

  v_prefix := p_user_id::text || '/' || v_listing_id::text || '/' || v_item.photo_id::text || '/';
  if p_source_storage_path <> v_item.source_storage_path
     or p_source_storage_path not like v_prefix || 'source.%'
     or not (p_canonical_storage_path = p_source_storage_path or p_canonical_storage_path like v_prefix || 'canonical.%') then
    raise exception 'invalid final storage path' using errcode = '22023';
  end if;

  select * into v_existing from photos where id = v_item.photo_id;
  if found and (
    v_existing.upload_item_id is distinct from v_item.id
    or v_existing.listing_id is distinct from v_listing_id
    or v_existing.source_storage_path is distinct from p_source_storage_path
    or v_existing.storage_path is distinct from p_canonical_storage_path
  ) then raise exception 'photo id conflict' using errcode = '23505'; end if;

  if not found then
    insert into photos (
      id, listing_id, room_id, storage_path, source_storage_path,
      source_content_type, source_byte_size, original_filename, width, height,
      is_floor_plan, upload_item_id, source_batch_id, intake_order, captured_at,
      exposure_time_seconds, exposure_bias_ev, aperture_f_number, iso,
      focal_length_mm, camera_make, camera_model, lens_model, source_metadata
    ) values (
      v_item.photo_id, v_listing_id, v_item.room_id, p_canonical_storage_path,
      p_source_storage_path, p_source_content_type, p_source_byte_size,
      v_item.original_filename, p_width, p_height, v_item.is_floor_plan,
      v_item.id, v_item.batch_id, v_item.intake_order, p_captured_at,
      p_exposure_time_seconds, p_exposure_bias_ev, p_aperture_f_number, p_iso,
      p_focal_length_mm, nullif(trim(p_camera_make), ''),
      nullif(trim(p_camera_model), ''), nullif(trim(p_lens_model), ''),
      coalesce(p_source_metadata, '{}'::jsonb)
    );
  end if;

  update upload_items
  set status = 'complete', canonical_storage_path = p_canonical_storage_path,
      source_content_type = p_source_content_type,
      canonical_content_type = p_canonical_content_type,
      source_byte_size = p_source_byte_size, width = p_width, height = p_height,
      error = null, finalized_at = coalesce(finalized_at, now()), updated_at = now()
  where id = p_item_id;

  if not exists (select 1 from upload_items where batch_id = v_item.batch_id and status not in ('complete', 'canceled')) then
    update upload_batches set status = 'complete', updated_at = now() where id = v_item.batch_id;
  end if;
  return v_item.photo_id;
end;
$$;

revoke all on function finalize_upload_item(uuid, uuid, text, text, text, text, bigint, int, int, timestamptz, numeric, numeric, numeric, int, numeric, text, text, text, jsonb) from public;
revoke all on function finalize_upload_item(uuid, uuid, text, text, text, text, bigint, int, int, timestamptz, numeric, numeric, numeric, int, numeric, text, text, text, jsonb) from authenticated;
grant execute on function finalize_upload_item(uuid, uuid, text, text, text, text, bigint, int, int, timestamptz, numeric, numeric, numeric, int, numeric, text, text, text, jsonb) to service_role;

-- Storage is written first at a deterministic immutable path. This function
-- atomically creates (or reuses) the traceable merged photo and confirms the
-- stack. Only the service role can cross that storage/database boundary.
create or replace function confirm_hdr_group(
  p_group_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_width int,
  p_height int,
  p_byte_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group photo_groups%rowtype;
  v_listing_id uuid;
  v_member_count int;
  v_room_id uuid;
  v_expected_path text;
  v_existing photos%rowtype;
begin
  select g.* into v_group
  from photo_groups g
  join listings l on l.id = g.listing_id
  where g.id = p_group_id and l.user_id = p_user_id
  for update of g;
  if not found then raise exception 'photo group not found' using errcode = 'P0002'; end if;
  if v_group.state = 'dismissed' then raise exception 'photo group was dismissed' using errcode = '22023'; end if;
  if v_group.state = 'confirmed' and v_group.representative_photo_id is not null then
    return v_group.representative_photo_id;
  end if;

  select count(*),
    case when count(distinct p.room_id) = 1
      then (array_agg(distinct p.room_id) filter (where p.room_id is not null))[1]
      else null
    end
  into v_member_count, v_room_id
  from photo_group_members m
  join photos p on p.id = m.photo_id
  where m.group_id = p_group_id
    and p.listing_id = v_group.listing_id
    and p.photo_role = 'source'
    and not p.is_floor_plan;
  if v_member_count < 3 or v_member_count > 9 then
    raise exception 'HDR group needs 3-9 source exposures' using errcode = '22023';
  end if;

  v_listing_id := v_group.listing_id;
  v_expected_path := p_user_id::text || '/' || v_listing_id::text || '/' || v_group.merge_photo_id::text || '/hdr-merged.jpg';
  if p_storage_path <> v_expected_path or p_width is null or p_height is null or p_byte_size <= 0 then
    raise exception 'invalid HDR representative metadata' using errcode = '22023';
  end if;

  select * into v_existing from photos where id = v_group.merge_photo_id;
  if found and (
    v_existing.listing_id is distinct from v_listing_id
    or v_existing.storage_path is distinct from p_storage_path
    or v_existing.photo_role is distinct from 'hdr_merged'
    or v_existing.hdr_group_id is distinct from p_group_id
  ) then raise exception 'HDR representative conflict' using errcode = '23505'; end if;

  if not found then
    insert into photos (
      id, listing_id, room_id, storage_path, source_storage_path,
      source_content_type, source_byte_size, original_filename, width, height,
      is_floor_plan, photo_role, hdr_group_id, source_metadata
    ) values (
      v_group.merge_photo_id, v_listing_id, v_room_id, p_storage_path, p_storage_path,
      'image/jpeg', p_byte_size, 'HDR-' || left(p_group_id::text, 8) || '.jpg',
      p_width, p_height, false, 'hdr_merged', p_group_id,
      jsonb_build_object('derived_from', 'hdr_bracket', 'group_id', p_group_id)
    );
  end if;

  update photo_groups
  set state = 'confirmed', representative_photo_id = merge_photo_id, updated_at = now()
  where id = p_group_id;
  return v_group.merge_photo_id;
end;
$$;

revoke all on function confirm_hdr_group(uuid, uuid, text, int, int, bigint) from public;
revoke all on function confirm_hdr_group(uuid, uuid, text, int, int, bigint) from authenticated;
grant execute on function confirm_hdr_group(uuid, uuid, text, int, int, bigint) to service_role;

create or replace function dismiss_hdr_group(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_group photo_groups%rowtype;
begin
  select g.* into v_group from photo_groups g
  join listings l on l.id = g.listing_id
  where g.id = p_group_id and l.user_id = p_user_id for update of g;
  if not found then raise exception 'photo group not found' using errcode = 'P0002'; end if;
  if v_group.state = 'confirmed' then raise exception 'reopen the confirmed group first' using errcode = '22023'; end if;
  update photos set hdr_decision = 'single'
  where id in (select photo_id from photo_group_members where group_id = p_group_id);
  delete from photo_group_members where group_id = p_group_id;
  update photo_groups set state = 'dismissed', representative_photo_id = null, updated_at = now() where id = p_group_id;
end;
$$;

create or replace function reopen_hdr_group(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update photo_groups g set state = 'proposed', representative_photo_id = null,
      merge_photo_id = gen_random_uuid(), updated_at = now()
  where g.id = p_group_id and g.state = 'confirmed'
    and exists (select 1 from listings l where l.id = g.listing_id and l.user_id = p_user_id);
  if not found then raise exception 'confirmed photo group not found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function dismiss_hdr_group(uuid, uuid) from public, authenticated;
revoke all on function reopen_hdr_group(uuid, uuid) from public, authenticated;
grant execute on function dismiss_hdr_group(uuid, uuid) to service_role;
grant execute on function reopen_hdr_group(uuid, uuid) to service_role;

create or replace function replace_hdr_group_members(
  p_group_id uuid,
  p_user_id uuid,
  p_photo_ids uuid[]
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_group photo_groups%rowtype;
  v_current uuid[];
  v_owned_count int;
begin
  select g.* into v_group from photo_groups g
  join listings l on l.id = g.listing_id
  where g.id = p_group_id and l.user_id = p_user_id for update of g;
  if not found then raise exception 'photo group not found' using errcode = 'P0002'; end if;
  if v_group.state <> 'proposed' then raise exception 'only proposed groups can be changed' using errcode = '22023'; end if;
  if cardinality(p_photo_ids) < 3 or cardinality(p_photo_ids) > 9 then
    raise exception 'HDR group needs 3-9 source exposures' using errcode = '22023';
  end if;
  if (select count(distinct id) from unnest(p_photo_ids) as ids(id)) <> cardinality(p_photo_ids) then
    raise exception 'duplicate photo in HDR group' using errcode = '22023';
  end if;

  select count(*) into v_owned_count from photos p
  where p.id = any(p_photo_ids) and p.listing_id = v_group.listing_id
    and p.photo_role = 'source' and not p.is_floor_plan;
  if v_owned_count <> cardinality(p_photo_ids) then
    raise exception 'one or more source photos are invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from photo_group_members m
    where m.photo_id = any(p_photo_ids) and m.group_id <> p_group_id
  ) then raise exception 'one or more photos already belong to another stack' using errcode = '23505'; end if;

  select array_agg(photo_id order by position) into v_current
  from photo_group_members where group_id = p_group_id;
  if v_current = p_photo_ids then return; end if;

  delete from photo_group_members where group_id = p_group_id;
  insert into photo_group_members(group_id, photo_id, position)
  select p_group_id, photo_id, ordinality::int
  from unnest(p_photo_ids) with ordinality as members(photo_id, ordinality);
  update photos set hdr_decision = 'unreviewed' where id = any(p_photo_ids);
  update photo_groups set merge_photo_id = gen_random_uuid(), representative_photo_id = null, updated_at = now()
  where id = p_group_id;
end;
$$;

revoke all on function replace_hdr_group_members(uuid, uuid, uuid[]) from public, authenticated;
grant execute on function replace_hdr_group_members(uuid, uuid, uuid[]) to service_role;
