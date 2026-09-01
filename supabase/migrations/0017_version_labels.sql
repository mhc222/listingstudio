-- Phase 52: decision-useful version names, durable branch context, and
-- idempotent single-source variation requests. Approval remains exclusively
-- owned by Phase 50's photo_finals contract.

alter table output_versions
  add column version_label text,
  add constraint output_versions_version_label_length
    check (
      version_label is null
      or (
        char_length(version_label) between 1 and 80
        and version_label = btrim(version_label)
      )
    );

alter table jobs drop constraint if exists jobs_kind_check;
alter table jobs
  add constraint jobs_kind_check check (kind in ('normal', 'ideas', 'variation'));

create table variation_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  source_output_version_id uuid not null references output_versions(id) on delete restrict,
  job_id uuid not null unique references jobs(id) on delete cascade,
  instructions text not null check (char_length(instructions) between 2 and 1000),
  labels text[] not null,
  requested_count int not null check (requested_count between 2 and 4),
  generation_cost_cents numeric not null check (generation_cost_cents >= 0),
  created_at timestamptz not null default now(),
  check (cardinality(labels) = requested_count)
);

create index variation_requests_listing_idx
  on variation_requests(listing_id, created_at desc);

alter table file_groups
  add column variation_request_id uuid references variation_requests(id) on delete restrict,
  add column variation_index int,
  add column requested_output_label text,
  add constraint file_groups_variation_identity
    check (
      (variation_request_id is null and variation_index is null and requested_output_label is null)
      or (
        variation_request_id is not null
        and variation_index between 1 and 4
        and requested_output_label is not null
        and char_length(requested_output_label) between 1 and 80
        and requested_output_label = btrim(requested_output_label)
      )
    );

create unique index file_groups_variation_sibling_unique
  on file_groups(variation_request_id, variation_index)
  where variation_request_id is not null;

create or replace function validate_output_version_parent_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_child_source uuid;
  v_child_listing uuid;
  v_parent_source uuid;
  v_parent_listing uuid;
begin
  if new.parent_version_id is null then return new; end if;
  if new.parent_version_id = new.id then
    raise exception 'an output version cannot parent itself' using errcode = '22023';
  end if;

  select fg.primary_photo_id, j.listing_id
    into v_child_source, v_child_listing
  from file_groups fg join jobs j on j.id = fg.job_id
  where fg.id = new.file_group_id;

  select fg.primary_photo_id, j.listing_id
    into v_parent_source, v_parent_listing
  from output_versions ov
  join file_groups fg on fg.id = ov.file_group_id
  join jobs j on j.id = fg.job_id
  where ov.id = new.parent_version_id;

  if v_child_source is null
     or v_parent_source is null
     or v_child_source is distinct from v_parent_source
     or v_child_listing is distinct from v_parent_listing then
    raise exception 'parent version must belong to the same listing photo' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger output_versions_validate_parent_lineage
before insert or update of parent_version_id, file_group_id on output_versions
for each row execute function validate_output_version_parent_lineage();

create or replace function guard_output_version_label_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (current_user in ('authenticated', 'anon') or auth.role() in ('authenticated', 'anon'))
     and (
       (tg_op = 'INSERT' and new.version_label is not null)
       or (tg_op = 'UPDATE' and old.version_label is distinct from new.version_label)
     ) then
    raise exception 'version labels are server managed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger output_versions_guard_label
before update of version_label on output_versions
for each row execute function guard_output_version_label_mutation();

create trigger output_versions_guard_label_insert
before insert on output_versions
for each row execute function guard_output_version_label_mutation();

alter table variation_requests enable row level security;

create policy "read own variation requests" on variation_requests
for select to authenticated
using (user_id = auth.uid() and exists (
  select 1 from listings l
  where l.id = listing_id and l.user_id = auth.uid()
));

alter publication supabase_realtime add table variation_requests;

create or replace function create_variation_request(
  p_request_id uuid,
  p_user_id uuid,
  p_source_output_version_id uuid,
  p_instructions text,
  p_labels text[],
  p_generation_cost_cents numeric
)
returns table(
  variation_request_id uuid,
  variation_job_id uuid,
  variation_file_group_ids uuid[],
  was_existing boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing variation_requests%rowtype;
  v_listing_id uuid;
  v_source_photo_id uuid;
  v_source_path text;
  v_source_chain jsonb;
  v_size_preset text;
  v_provider text;
  v_count int := cardinality(p_labels);
  v_job_id uuid;
  v_request_id uuid;
  v_group_id uuid;
  v_group_ids uuid[] := '{}';
  v_chain jsonb;
  v_index int;
  v_label text;
begin
  if p_request_id is null or p_user_id is null or p_source_output_version_id is null then
    raise exception 'request, user, and source version are required' using errcode = '22023';
  end if;
  if p_instructions is null or char_length(btrim(p_instructions)) not between 2 and 1000 then
    raise exception 'variation instructions must be 2-1000 characters' using errcode = '22023';
  end if;
  if v_count not between 2 and 4 then
    raise exception 'variation count must be 2-4' using errcode = '22023';
  end if;
  if p_generation_cost_cents is null or p_generation_cost_cents < 0 then
    raise exception 'generation cost must be non-negative' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_labels) label
    where label is null
      or char_length(label) not between 1 and 80
      or label is distinct from btrim(label)
  ) then
    raise exception 'variation labels must be trimmed and 1-80 characters' using errcode = '22023';
  end if;
  if (select count(distinct lower(label)) from unnest(p_labels) label) <> v_count then
    raise exception 'variation labels must be unique' using errcode = '22023';
  end if;

  select * into v_existing
  from variation_requests vr
  where vr.id = p_request_id;
  if found then
    if v_existing.user_id is distinct from p_user_id
       or v_existing.source_output_version_id is distinct from p_source_output_version_id
       or v_existing.instructions is distinct from btrim(p_instructions)
       or v_existing.labels is distinct from p_labels
       or v_existing.requested_count is distinct from v_count
       or v_existing.generation_cost_cents is distinct from p_generation_cost_cents then
      raise exception 'request id was already used for another variation request' using errcode = '23505';
    end if;
    select coalesce(array_agg(fg.id order by fg.variation_index), '{}')
      into v_group_ids
    from file_groups fg
    where fg.variation_request_id = v_existing.id;
    return query select v_existing.id, v_existing.job_id, v_group_ids, true;
    return;
  end if;

  select j.listing_id, fg.primary_photo_id, ov.storage_path, fg.edit_chain,
         fg.size_preset, fg.provider
    into v_listing_id, v_source_photo_id, v_source_path, v_source_chain,
         v_size_preset, v_provider
  from output_versions ov
  join file_groups fg on fg.id = ov.file_group_id
  join jobs j on j.id = fg.job_id
  join listings l on l.id = j.listing_id
  where ov.id = p_source_output_version_id
    and l.user_id = p_user_id;
  if not found then raise exception 'source version not found' using errcode = 'P0002'; end if;
  if v_provider is null then raise exception 'source version has no generation provider' using errcode = '55000'; end if;

  insert into jobs (
    listing_id, title, status, kind, target_request_id, target_snapshot, submitted_at
  ) values (
    v_listing_id,
    format('Variations ×%s — %s', v_count, left(btrim(p_instructions), 60)),
    'processing',
    'variation',
    p_request_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'selectionMethod', 'version_variations',
      'sourcePhotoId', v_source_photo_id,
      'sourceOutputVersionId', p_source_output_version_id,
      'labels', to_jsonb(p_labels),
      'requestedGenerationCount', v_count,
      'initialGenerationCostCents', p_generation_cost_cents
    ),
    now()
  ) returning id into v_job_id;

  insert into variation_requests (
    id, user_id, listing_id, source_output_version_id, job_id,
    instructions, labels, requested_count, generation_cost_cents
  ) values (
    p_request_id, p_user_id, v_listing_id, p_source_output_version_id, v_job_id,
    btrim(p_instructions), p_labels, v_count, p_generation_cost_cents
  ) returning id into v_request_id;

  for v_index in 1..v_count loop
    v_label := p_labels[v_index];
    v_chain := v_source_chain || jsonb_build_array(jsonb_build_object(
      'edit_type', 'REWORK',
      'options', jsonb_build_object(
        'instructions', btrim(p_instructions),
        'source_path', v_source_path,
        'parent_version_id', p_source_output_version_id
      )
    ));
    insert into file_groups (
      job_id, primary_photo_id, edit_chain, comment, size_preset, provider,
      current_step, variation_request_id, variation_index, requested_output_label
    ) values (
      v_job_id, v_source_photo_id, v_chain, btrim(p_instructions), v_size_preset, v_provider,
      jsonb_array_length(v_chain) - 1, v_request_id, v_index, v_label
    ) returning id into v_group_id;
    v_group_ids := array_append(v_group_ids, v_group_id);
    insert into chat_messages(file_group_id, role, content)
    values (v_group_id, 'user', btrim(p_instructions));
  end loop;

  return query select v_request_id, v_job_id, v_group_ids, false;
end;
$$;

revoke all on function create_variation_request(uuid, uuid, uuid, text, text[], numeric)
  from public, authenticated;
grant execute on function create_variation_request(uuid, uuid, uuid, text, text[], numeric)
  to service_role;

comment on column output_versions.version_label is
  'Optional user-facing name. Naming never changes review state or the approved final pointer.';
comment on table variation_requests is
  'Immutable idempotency record for 2-4 independent siblings branched from one exact output version.';
comment on column file_groups.requested_output_label is
  'Label copied onto the immutable output produced for one variation sibling.';
