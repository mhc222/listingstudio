-- Phase 50: explicit human review and one durable final per logical source.
-- Viewing, comparing, downloading, or creating a later version never writes
-- these fields. All mutations pass through the service-role RPC below after
-- an authenticated route proves listing ownership.

alter table output_versions
  add column review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed', 'needs_changes', 'approved')),
  add column review_note text,
  add column reviewed_at timestamptz,
  add constraint output_versions_review_note_length
    check (review_note is null or char_length(review_note) <= 2000);

create index output_versions_review_state_idx
  on output_versions(file_group_id, review_state);

create table photo_finals (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  source_photo_id uuid not null references photos(id) on delete restrict,
  -- Null deliberately means the untouched source original is the final.
  output_version_id uuid references output_versions(id) on delete restrict,
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, source_photo_id)
);

create index photo_finals_listing_idx on photo_finals(listing_id, selected_at);
create unique index photo_finals_output_version_unique
  on photo_finals(output_version_id) where output_version_id is not null;

-- Request receipts make retries true no-ops. An old response retried after a
-- newer decision cannot silently move the final pointer backwards.
create table proofing_requests (
  id uuid primary key,
  listing_id uuid not null references listings(id) on delete cascade,
  source_photo_id uuid not null references photos(id) on delete restrict,
  action text not null check (action in ('approve', 'needs_changes')),
  output_version_id uuid references output_versions(id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  check (note is null or char_length(note) <= 2000),
  check (action = 'approve' or output_version_id is not null)
);

create index proofing_requests_listing_idx
  on proofing_requests(listing_id, created_at);

create or replace function guard_output_version_review_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (current_user in ('authenticated', 'anon') or auth.role() in ('authenticated', 'anon'))
     and (
       old.review_state is distinct from new.review_state
       or old.review_note is distinct from new.review_note
       or old.reviewed_at is distinct from new.reviewed_at
     ) then
    raise exception 'proofing state is server managed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger output_versions_guard_review
before update of review_state, review_note, reviewed_at on output_versions
for each row execute function guard_output_version_review_mutation();

create or replace function validate_photo_final_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_version_source uuid;
  v_version_listing uuid;
begin
  if not is_current_logical_photo(new.listing_id, new.source_photo_id) then
    raise exception 'photo is not a current logical source' using errcode = '55000';
  end if;

  if new.output_version_id is not null then
    select fg.primary_photo_id, j.listing_id
      into v_version_source, v_version_listing
    from output_versions ov
    join file_groups fg on fg.id = ov.file_group_id
    join jobs j on j.id = fg.job_id
    where ov.id = new.output_version_id;
    if not found
       or v_version_listing is distinct from new.listing_id
       or v_version_source is distinct from new.source_photo_id then
      raise exception 'output version does not belong to this logical source' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger photo_finals_validate_lineage
before insert or update on photo_finals
for each row execute function validate_photo_final_lineage();

alter table photo_finals enable row level security;
alter table proofing_requests enable row level security;

create policy "read own photo finals" on photo_finals for select to authenticated
  using (exists (
    select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
  ));

create policy "read own proofing requests" on proofing_requests for select to authenticated
  using (exists (
    select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
  ));

alter publication supabase_realtime add table photo_finals;

create or replace function set_photo_review(
  p_request_id uuid,
  p_listing_id uuid,
  p_user_id uuid,
  p_source_photo_id uuid,
  p_action text,
  p_output_version_id uuid default null,
  p_note text default null
)
returns table(final_id uuid, final_output_version_id uuid, final_selected_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing proofing_requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_version_source uuid;
  v_version_listing uuid;
  v_final photo_finals%rowtype;
begin
  if p_request_id is null then
    raise exception 'request id is required' using errcode = '22023';
  end if;
  if p_action not in ('approve', 'needs_changes') then
    raise exception 'unsupported proofing action' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'review note is too long' using errcode = '22023';
  end if;
  if p_action = 'needs_changes' and p_output_version_id is null then
    raise exception 'needs changes requires an output version' using errcode = '22023';
  end if;

  perform 1 from listings l
  where l.id = p_listing_id and l.user_id = p_user_id
  for update;
  if not found then raise exception 'listing not found' using errcode = 'P0002'; end if;

  if not is_current_logical_photo(p_listing_id, p_source_photo_id) then
    raise exception 'photo is not a current logical source' using errcode = '55000';
  end if;

  if p_output_version_id is not null then
    select fg.primary_photo_id, j.listing_id
      into v_version_source, v_version_listing
    from output_versions ov
    join file_groups fg on fg.id = ov.file_group_id
    join jobs j on j.id = fg.job_id
    where ov.id = p_output_version_id;

    if not found
       or v_version_listing is distinct from p_listing_id
       or v_version_source is distinct from p_source_photo_id then
      raise exception 'output version does not belong to this logical source' using errcode = '22023';
    end if;
  end if;

  select * into v_existing from proofing_requests where id = p_request_id;
  if found then
    if v_existing.listing_id is distinct from p_listing_id
       or v_existing.source_photo_id is distinct from p_source_photo_id
       or v_existing.action is distinct from p_action
       or v_existing.output_version_id is distinct from p_output_version_id
       or v_existing.note is distinct from v_note then
      raise exception 'request id was already used for another review decision' using errcode = '23505';
    end if;

    select * into v_final from photo_finals
    where listing_id = p_listing_id and source_photo_id = p_source_photo_id;
    return query select v_final.id, v_final.output_version_id, v_final.selected_at;
    return;
  end if;

  insert into proofing_requests (
    id, listing_id, source_photo_id, action, output_version_id, note
  ) values (
    p_request_id, p_listing_id, p_source_photo_id, p_action,
    p_output_version_id, v_note
  );

  if p_action = 'approve' then
    -- A source has only one approved decision. Preserve needs-changes notes on
    -- abandoned alternatives, but retire any prior approved version state.
    update output_versions ov
      set review_state = 'unreviewed', review_note = null, reviewed_at = now()
    from file_groups fg join jobs j on j.id = fg.job_id
    where ov.file_group_id = fg.id
      and j.listing_id = p_listing_id
      and fg.primary_photo_id = p_source_photo_id
      and ov.review_state = 'approved';

    if p_output_version_id is not null then
      update output_versions
      set review_state = 'approved', review_note = null, reviewed_at = now()
      where id = p_output_version_id;
    end if;

    insert into photo_finals (
      listing_id, source_photo_id, output_version_id, selected_at, updated_at
    ) values (
      p_listing_id, p_source_photo_id, p_output_version_id, now(), now()
    )
    on conflict (listing_id, source_photo_id) do update
      set output_version_id = excluded.output_version_id,
          selected_at = now(),
          updated_at = now()
    returning * into v_final;
  else
    update output_versions
    set review_state = 'needs_changes', review_note = v_note, reviewed_at = now()
    where id = p_output_version_id;

    -- A final cannot simultaneously be the version that needs changes. Other
    -- explicit finals (including the untouched original) remain stable.
    delete from photo_finals
    where listing_id = p_listing_id
      and source_photo_id = p_source_photo_id
      and output_version_id = p_output_version_id;

    select * into v_final from photo_finals
    where listing_id = p_listing_id and source_photo_id = p_source_photo_id;
  end if;

  return query select v_final.id, v_final.output_version_id, v_final.selected_at;
end;
$$;

revoke all on function set_photo_review(uuid, uuid, uuid, uuid, text, uuid, text)
  from public, authenticated;
grant execute on function set_photo_review(uuid, uuid, uuid, uuid, text, uuid, text)
  to service_role;

comment on table photo_finals is
  'One explicit approved final per current logical source; null output_version_id deliberately selects the untouched original.';
comment on table proofing_requests is
  'Immutable idempotency receipts for approve and needs-changes decisions.';
comment on column output_versions.review_state is
  'Human proofing state only; generation completion and viewing never change it.';
