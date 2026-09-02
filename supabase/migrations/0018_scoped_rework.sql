-- Phase 53: one immutable, idempotent correction applied only to an explicit
-- set of exact source versions. Each target owns an independent FileGroup so
-- partial failure and retry cannot erase successful siblings or move finals.

alter table jobs drop constraint if exists jobs_kind_check;
alter table jobs
  add constraint jobs_kind_check
  check (kind in ('normal', 'ideas', 'variation', 'scoped_rework'));

create table scoped_rework_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  job_id uuid not null unique references jobs(id) on delete cascade,
  selection_method text not null check (selection_method in ('explicit', 'room', 'same_room_group')),
  scope_id uuid,
  instructions text not null check (
    char_length(instructions) between 2 and 1000 and instructions = btrim(instructions)
  ),
  target_count int not null check (target_count between 2 and 100),
  generation_count int not null check (generation_count = target_count),
  generation_cost_cents numeric not null check (generation_cost_cents >= 0),
  requested_targets jsonb not null check (jsonb_typeof(requested_targets) = 'array'),
  target_snapshot jsonb not null check (jsonb_typeof(target_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  check (
    (selection_method = 'explicit' and scope_id is null)
    or (selection_method in ('room', 'same_room_group') and scope_id is not null)
  )
);

create index scoped_rework_requests_listing_idx
  on scoped_rework_requests(listing_id, created_at desc);

create table scoped_rework_targets (
  request_id uuid not null references scoped_rework_requests(id) on delete cascade,
  position int not null check (position >= 0),
  source_photo_id uuid not null references photos(id) on delete restrict,
  source_output_version_id uuid not null references output_versions(id) on delete restrict,
  file_group_id uuid not null unique references file_groups(id) on delete cascade,
  protected_geometry text not null check (protected_geometry in ('interior', 'exterior')),
  exception text check (
    exception is null
    or (char_length(exception) between 2 and 500 and exception = btrim(exception))
  ),
  primary key (request_id, position),
  unique (request_id, source_photo_id),
  unique (request_id, source_output_version_id)
);

alter table scoped_rework_requests enable row level security;
alter table scoped_rework_targets enable row level security;

create policy "read own scoped rework requests" on scoped_rework_requests
for select to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
  )
);

create policy "read own scoped rework targets" on scoped_rework_targets
for select to authenticated
using (exists (
  select 1 from scoped_rework_requests request
  where request.id = request_id and request.user_id = auth.uid()
));

alter publication supabase_realtime add table scoped_rework_requests, scoped_rework_targets;

create or replace function create_scoped_rework_request(
  p_request_id uuid,
  p_user_id uuid,
  p_listing_id uuid,
  p_selection_method text,
  p_scope_id uuid,
  p_instructions text,
  p_targets jsonb,
  p_generation_cost_cents numeric
)
returns table(
  scoped_rework_request_id uuid,
  scoped_rework_job_id uuid,
  scoped_rework_file_group_ids uuid[],
  was_existing boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing scoped_rework_requests%rowtype;
  v_count int;
  v_target jsonb;
  v_position int;
  v_photo_id uuid;
  v_version_id uuid;
  v_exception text;
  v_geometry text;
  v_expected_geometry text;
  v_source_group_id uuid;
  v_source_path text;
  v_source_chain jsonb;
  v_size_preset text;
  v_provider text;
  v_room_id uuid;
  v_same_room_group_id uuid;
  v_target_snapshot jsonb := '[]'::jsonb;
  v_job_snapshot jsonb;
  v_job_id uuid;
  v_group_id uuid;
  v_group_ids uuid[] := array[]::uuid[];
  v_chain jsonb;
  v_correction text;
begin
  if p_request_id is null or p_user_id is null or p_listing_id is null then
    raise exception 'request, user, and listing are required' using errcode = '22023';
  end if;
  if p_selection_method not in ('explicit', 'room', 'same_room_group') then
    raise exception 'unsupported scoped rework selection method' using errcode = '22023';
  end if;
  if (p_selection_method = 'explicit' and p_scope_id is not null)
     or (p_selection_method <> 'explicit' and p_scope_id is null) then
    raise exception 'selection method and scope do not match' using errcode = '22023';
  end if;
  if p_instructions is null or char_length(btrim(p_instructions)) not between 2 and 1000 then
    raise exception 'shared correction must be 2-1000 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_targets) <> 'array' then
    raise exception 'scoped rework targets must be an array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_targets);
  if v_count not between 2 and 100 then
    raise exception 'scoped rework requires 2-100 targets' using errcode = '22023';
  end if;
  if p_generation_cost_cents is null or p_generation_cost_cents < 0 then
    raise exception 'generation cost must be non-negative' using errcode = '22023';
  end if;
  if not exists (
    select 1 from listings l where l.id = p_listing_id and l.user_id = p_user_id
  ) then
    raise exception 'listing not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_existing from scoped_rework_requests request where request.id = p_request_id;
  if found then
    if v_existing.user_id is distinct from p_user_id
       or v_existing.listing_id is distinct from p_listing_id
       or v_existing.selection_method is distinct from p_selection_method
       or v_existing.scope_id is distinct from p_scope_id
       or v_existing.instructions is distinct from btrim(p_instructions)
       or v_existing.requested_targets is distinct from p_targets
       or v_existing.generation_cost_cents is distinct from p_generation_cost_cents then
      raise exception 'request id was already used for another scoped rework' using errcode = '23505';
    end if;
    select coalesce(array_agg(target.file_group_id order by target.position), '{}')
      into v_group_ids
    from scoped_rework_targets target where target.request_id = v_existing.id;
    return query select v_existing.id, v_existing.job_id, v_group_ids, true;
    return;
  end if;

  if (
    select count(distinct target->>'sourcePhotoId') <> v_count
      or count(distinct target->>'sourceOutputVersionId') <> v_count
    from jsonb_array_elements(p_targets) target
  ) then
    raise exception 'scoped rework targets must be unique by photo and version' using errcode = '22023';
  end if;

  for v_target, v_position in
    select value, (ordinality - 1)::int
    from jsonb_array_elements(p_targets) with ordinality
  loop
    begin
      v_photo_id := (v_target->>'sourcePhotoId')::uuid;
      v_version_id := (v_target->>'sourceOutputVersionId')::uuid;
    exception when others then
      raise exception 'scoped rework target identity is invalid' using errcode = '22023';
    end;
    v_exception := nullif(btrim(v_target->>'exception'), '');
    if v_exception is not null and char_length(v_exception) not between 2 and 500 then
      raise exception 'target exception must be 2-500 characters' using errcode = '22023';
    end if;
    v_geometry := v_target->>'protectedGeometry';
    if v_geometry not in ('interior', 'exterior') then
      raise exception 'protected geometry is invalid' using errcode = '22023';
    end if;

    select fg.id, ov.storage_path, fg.edit_chain, fg.size_preset, fg.provider,
           p.room_id,
           (select member.group_id from same_room_group_members member where member.photo_id = p.id)
      into v_source_group_id, v_source_path, v_source_chain, v_size_preset, v_provider,
           v_room_id, v_same_room_group_id
    from output_versions ov
    join file_groups fg on fg.id = ov.file_group_id
    join jobs j on j.id = fg.job_id
    join photos p on p.id = fg.primary_photo_id
    where ov.id = v_version_id
      and fg.primary_photo_id = v_photo_id
      and j.listing_id = p_listing_id
      and p.listing_id = p_listing_id;
    if not found then
      raise exception 'source version not found for selected photo' using errcode = 'P0002';
    end if;
    if not is_current_logical_photo(p_listing_id, v_photo_id) then
      raise exception 'source photo is no longer in the current logical shoot' using errcode = '55000';
    end if;
    if v_provider is null then
      raise exception 'source version has no generation provider' using errcode = '55000';
    end if;
    if p_selection_method = 'room' and v_room_id is distinct from p_scope_id then
      raise exception 'target escaped the selected room scope' using errcode = '22023';
    end if;
    if p_selection_method = 'same_room_group' and v_same_room_group_id is distinct from p_scope_id then
      raise exception 'target escaped the selected same-room group scope' using errcode = '22023';
    end if;

    select case when exists (
      select 1 from jsonb_array_elements(v_source_chain) step
      where step->>'edit_type' in ('DAY_TO_DUSK', 'VIRTUAL_LANDSCAPING', 'AERIAL_EDITING')
    ) then 'exterior' else 'interior' end into v_expected_geometry;
    if v_geometry is distinct from v_expected_geometry then
      raise exception 'protected geometry does not match the exact source chain' using errcode = '22023';
    end if;

    v_target_snapshot := v_target_snapshot || jsonb_build_array(jsonb_build_object(
      'position', v_position,
      'sourcePhotoId', v_photo_id,
      'sourceOutputVersionId', v_version_id,
      'sourceFileGroupId', v_source_group_id,
      'roomId', v_room_id,
      'sameRoomGroupId', v_same_room_group_id,
      'protectedGeometry', v_geometry,
      'exception', v_exception
    ));
  end loop;

  v_job_snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'selectionMethod', p_selection_method,
    'scopeId', p_scope_id,
    'sharedCorrection', btrim(p_instructions),
    'targetCount', v_count,
    'requestedGenerationCount', v_count,
    'initialGenerationCostCents', p_generation_cost_cents,
    'targets', v_target_snapshot
  );

  insert into jobs (
    listing_id, title, status, kind, target_request_id, target_snapshot, submitted_at
  ) values (
    p_listing_id,
    format('Batch refinement ×%s — %s', v_count, left(btrim(p_instructions), 60)),
    'processing',
    'scoped_rework',
    p_request_id,
    v_job_snapshot,
    now()
  ) returning id into v_job_id;

  insert into scoped_rework_requests (
    id, user_id, listing_id, job_id, selection_method, scope_id, instructions,
    target_count, generation_count, generation_cost_cents, requested_targets, target_snapshot
  ) values (
    p_request_id, p_user_id, p_listing_id, v_job_id, p_selection_method, p_scope_id,
    btrim(p_instructions), v_count, v_count, p_generation_cost_cents, p_targets, v_job_snapshot
  );

  for v_target, v_position in
    select value, (ordinality - 1)::int
    from jsonb_array_elements(v_target_snapshot) with ordinality
  loop
    v_photo_id := (v_target->>'sourcePhotoId')::uuid;
    v_version_id := (v_target->>'sourceOutputVersionId')::uuid;
    v_source_group_id := (v_target->>'sourceFileGroupId')::uuid;
    v_geometry := v_target->>'protectedGeometry';
    v_exception := nullif(v_target->>'exception', '');

    select ov.storage_path, fg.edit_chain, fg.size_preset, fg.provider
      into v_source_path, v_source_chain, v_size_preset, v_provider
    from output_versions ov join file_groups fg on fg.id = ov.file_group_id
    where ov.id = v_version_id and fg.id = v_source_group_id;

    v_correction := btrim(p_instructions) || case
      when v_exception is null then ''
      else ' Target-specific exception: ' || v_exception
    end;
    v_chain := v_source_chain || jsonb_build_array(jsonb_build_object(
      'edit_type', 'REWORK',
      'options', jsonb_build_object(
        'instructions', v_correction,
        'source_path', v_source_path,
        'parent_version_id', v_version_id,
        'protected_geometry', v_geometry
      )
    ));

    insert into file_groups (
      job_id, primary_photo_id, edit_chain, comment, size_preset, provider, current_step
    ) values (
      v_job_id, v_photo_id, v_chain, v_correction, v_size_preset, v_provider,
      jsonb_array_length(v_chain) - 1
    ) returning id into v_group_id;
    v_group_ids := array_append(v_group_ids, v_group_id);

    insert into scoped_rework_targets (
      request_id, position, source_photo_id, source_output_version_id,
      file_group_id, protected_geometry, exception
    ) values (
      p_request_id, v_position, v_photo_id, v_version_id,
      v_group_id, v_geometry, v_exception
    );
    insert into chat_messages(file_group_id, role, content)
    values (v_group_id, 'user', v_correction);
  end loop;

  return query select p_request_id, v_job_id, v_group_ids, false;
end;
$$;

revoke all on function create_scoped_rework_request(uuid, uuid, uuid, text, uuid, text, jsonb, numeric)
  from public, authenticated;
grant execute on function create_scoped_rework_request(uuid, uuid, uuid, text, uuid, text, jsonb, numeric)
  to service_role;

comment on table scoped_rework_requests is
  'Immutable receipt and exact scope snapshot for one explicit multi-photo correction.';
comment on table scoped_rework_targets is
  'Ordered exact-version targets with independently recoverable FileGroups and optional exceptions.';

