-- Phase 46: review-gated room proposals and durable same-room angle groups.

create table room_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  request_key uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'partial', 'failed')),
  model text not null,
  logical_photo_ids uuid[] not null default '{}'::uuid[],
  analyzed_photo_count int not null default 0 check (analyzed_photo_count >= 0),
  cost_cents numeric not null default 0 check (cost_cents >= 0),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (listing_id, request_key)
);

create table room_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references room_analysis_runs(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  photo_id uuid not null references photos(id) on delete cascade,
  proposed_room_type room_type not null,
  proposed_room_name text not null check (char_length(trim(proposed_room_name)) between 1 and 80),
  proposed_room_id uuid references rooms(id) on delete set null,
  proposed_same_room_key text,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  evidence text not null check (char_length(trim(evidence)) between 1 and 280),
  review_state text not null check (review_state in ('suggested', 'needs_review', 'confirmed', 'untagged')),
  decision text not null default 'pending' check (decision in ('pending', 'accepted', 'deferred')),
  accepted_room_id uuid references rooms(id) on delete set null,
  is_current boolean not null default true,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, photo_id),
  check (proposed_same_room_key is null or char_length(proposed_same_room_key) between 1 and 80),
  check (
    (decision = 'accepted' and review_state = 'confirmed' and accepted_room_id is not null and decided_at is not null)
    or (decision = 'deferred' and review_state = 'untagged' and accepted_room_id is null and decided_at is not null)
    or (decision = 'pending' and review_state in ('suggested', 'needs_review', 'untagged') and accepted_room_id is null and decided_at is null)
  )
);

create unique index room_proposals_current_photo_idx
  on room_proposals(listing_id, photo_id) where is_current;
create index room_proposals_listing_review_idx
  on room_proposals(listing_id, is_current, review_state, created_at);
create index room_analysis_runs_listing_idx
  on room_analysis_runs(listing_id, created_at desc);

create table same_room_groups (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  source_run_id uuid references room_analysis_runs(id) on delete set null,
  proposal_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposal_key is null or char_length(proposal_key) between 1 and 80)
);

create unique index same_room_groups_proposal_idx
  on same_room_groups(source_run_id, proposal_key)
  where source_run_id is not null and proposal_key is not null;
create index same_room_groups_listing_idx on same_room_groups(listing_id, room_id, created_at);

create table same_room_group_members (
  group_id uuid not null references same_room_groups(id) on delete cascade,
  photo_id uuid not null unique references photos(id) on delete cascade,
  position int not null check (position > 0),
  primary key (group_id, photo_id),
  unique (group_id, position)
);

create index same_room_group_members_group_idx
  on same_room_group_members(group_id, position);

alter table spend_ledger
  add column listing_id uuid references listings(id) on delete set null,
  add column room_analysis_run_id uuid references room_analysis_runs(id) on delete set null;
create index spend_ledger_listing_idx on spend_ledger(listing_id, created_at);

drop policy "own spend_ledger" on spend_ledger;
create policy "own spend_ledger" on spend_ledger for all
  using (
    exists (
      select 1 from jobs j join listings l on l.id = j.listing_id
      where j.id = job_id and l.user_id = auth.uid()
    )
    or exists (
      select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
    )
  );

alter table room_analysis_runs enable row level security;
alter table room_proposals enable row level security;
alter table same_room_groups enable row level security;
alter table same_room_group_members enable row level security;

-- Analysis and review mutations cross several tables and are server-only.
-- Authenticated clients can read owned state; routes perform a fresh owned
-- listing read before using the service-role lifecycle functions below.
create policy "read own room analysis runs" on room_analysis_runs for select to authenticated
  using (exists (
    select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
  ));
create policy "read own room proposals" on room_proposals for select to authenticated
  using (exists (
    select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
  ));
create policy "read own same room groups" on same_room_groups for select to authenticated
  using (exists (
    select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
  ));
create policy "read own same room group members" on same_room_group_members for select to authenticated
  using (exists (
    select 1 from same_room_groups g
    join listings l on l.id = g.listing_id
    where g.id = group_id and l.user_id = auth.uid()
  ));

alter publication supabase_realtime add table room_analysis_runs, room_proposals, same_room_groups, same_room_group_members;

-- A room-analysis target must be one member of the same logical-photo set the
-- Phase 45 tray exposes: never a floor plan, confirmed bracket source, or stale
-- HDR derivative.
create or replace function is_current_logical_photo(p_listing_id uuid, p_photo_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from photos p
    where p.id = p_photo_id and p.listing_id = p_listing_id and not p.is_floor_plan
      and not exists (
        select 1 from photo_group_members m
        join photo_groups g on g.id = m.group_id
        where m.photo_id = p.id and g.listing_id = p_listing_id and g.state = 'confirmed'
      )
      and (
        p.photo_role <> 'hdr_merged'
        or exists (
          select 1 from photo_groups g
          where g.listing_id = p_listing_id and g.state = 'confirmed'
            and g.representative_photo_id = p.id
        )
      )
  );
$$;

-- Apply reviewed decisions atomically. Proposals may persist before review,
-- but photo.room_id and same_room_group_members change only in this function.
create or replace function apply_room_proposal_decisions(
  p_listing_id uuid,
  p_user_id uuid,
  p_decisions jsonb
)
returns table(accepted_count int, deferred_count int)
language plpgsql security definer set search_path = public as $$
declare
  v_decision jsonb;
  v_proposal room_proposals%rowtype;
  v_action text;
  v_room_id uuid;
  v_room_type room_type;
  v_room_name text;
  v_same_key text;
  v_group_id uuid;
  v_existing_group same_room_groups%rowtype;
  v_accepted int := 0;
  v_deferred int := 0;
begin
  if not exists (
    select 1 from listings l where l.id = p_listing_id and l.user_id = p_user_id
  ) then raise exception 'listing not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception 'decisions must be a non-empty array' using errcode = '22023';
  end if;

  for v_decision in select value from jsonb_array_elements(p_decisions)
  loop
    select p.* into v_proposal
    from room_proposals p
    where p.id = (v_decision->>'proposal_id')::uuid
      and p.listing_id = p_listing_id and p.is_current
    for update of p;
    if not found then raise exception 'current room proposal not found' using errcode = 'P0002'; end if;
    if not is_current_logical_photo(p_listing_id, v_proposal.photo_id) then
      raise exception 'proposal photo is no longer a logical photo' using errcode = '55000';
    end if;

    v_action := v_decision->>'action';
    if v_action = 'defer' then
      if v_proposal.decision = 'accepted' then
        raise exception 'an accepted proposal cannot be deferred' using errcode = '22023';
      end if;
      update room_proposals set decision = 'deferred', review_state = 'untagged',
        accepted_room_id = null, decided_at = coalesce(decided_at, now()), updated_at = now()
      where id = v_proposal.id;
      v_deferred := v_deferred + 1;
      continue;
    end if;
    if v_action <> 'accept' then
      raise exception 'decision action must be accept or defer' using errcode = '22023';
    end if;

    v_same_key := case
      when v_decision ? 'same_room_key' then nullif(trim(v_decision->>'same_room_key'), '')
      else v_proposal.proposed_same_room_key
    end;
    if v_same_key is not null and char_length(v_same_key) > 80 then
      raise exception 'same-room key is too long' using errcode = '22023';
    end if;

    v_room_id := null;
    if nullif(v_decision->>'room_id', '') is not null then
      v_room_id := (v_decision->>'room_id')::uuid;
    elsif v_proposal.accepted_room_id is not null then
      v_room_id := v_proposal.accepted_room_id;
    elsif v_proposal.proposed_room_id is not null then
      v_room_id := v_proposal.proposed_room_id;
    end if;

    if v_same_key is not null then
      select g.* into v_existing_group from same_room_groups g
      where g.source_run_id = v_proposal.run_id and g.proposal_key = v_same_key;
      if found then
        if v_room_id is not null and v_room_id <> v_existing_group.room_id then
          raise exception 'same-room members must use the same room' using errcode = '22023';
        end if;
        v_room_id := v_existing_group.room_id;
      end if;
    end if;

    if v_room_id is not null then
      select r.room_type, r.name into v_room_type, v_room_name from rooms r
      where r.id = v_room_id and r.listing_id = p_listing_id;
      if not found then raise exception 'room not found' using errcode = 'P0002'; end if;
    else
      v_room_type := coalesce(nullif(v_decision->>'room_type', '')::room_type, v_proposal.proposed_room_type);
      v_room_name := left(coalesce(nullif(trim(v_decision->>'room_name'), ''), v_proposal.proposed_room_name), 80);
      insert into rooms(listing_id, name, room_type)
      values (p_listing_id, v_room_name, v_room_type)
      returning id into v_room_id;
    end if;

    update photos set room_id = v_room_id where id = v_proposal.photo_id;

    if v_same_key is not null then
      if v_existing_group.id is null then
        insert into same_room_groups(listing_id, room_id, name, source_run_id, proposal_key)
        values (p_listing_id, v_room_id, v_room_name, v_proposal.run_id, v_same_key)
        returning id into v_group_id;
      else
        v_group_id := v_existing_group.id;
      end if;
      insert into same_room_group_members(group_id, photo_id, position)
      values (
        v_group_id,
        v_proposal.photo_id,
        coalesce((select max(position) + 1 from same_room_group_members where group_id = v_group_id), 1)
      )
      on conflict (photo_id) do update set group_id = excluded.group_id, position = excluded.position;
    else
      delete from same_room_group_members where photo_id = v_proposal.photo_id;
      delete from same_room_groups g where g.listing_id = p_listing_id
        and (select count(*) from same_room_group_members m where m.group_id = g.id) < 2;
    end if;

    update room_proposals set decision = 'accepted', review_state = 'confirmed',
      accepted_room_id = v_room_id, decided_at = coalesce(decided_at, now()), updated_at = now()
    where id = v_proposal.id;
    v_accepted := v_accepted + 1;
  end loop;
  return query select v_accepted, v_deferred;
end;
$$;

create or replace function replace_same_room_group_members(
  p_group_id uuid,
  p_user_id uuid,
  p_photo_ids uuid[]
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_group same_room_groups%rowtype;
  v_valid_count int;
begin
  select g.* into v_group from same_room_groups g
  join listings l on l.id = g.listing_id
  where g.id = p_group_id and l.user_id = p_user_id for update of g;
  if not found then raise exception 'same-room group not found' using errcode = 'P0002'; end if;
  if coalesce(cardinality(p_photo_ids), 0) < 2 then
    delete from same_room_groups where id = p_group_id;
    return;
  end if;
  if (select count(distinct id) from unnest(p_photo_ids) ids(id)) <> cardinality(p_photo_ids) then
    raise exception 'duplicate photo in same-room group' using errcode = '22023';
  end if;
  select count(*) into v_valid_count from photos p
  where p.id = any(p_photo_ids) and p.listing_id = v_group.listing_id
    and p.room_id = v_group.room_id and is_current_logical_photo(v_group.listing_id, p.id);
  if v_valid_count <> cardinality(p_photo_ids) then
    raise exception 'same-room members must be current logical photos in the same confirmed room' using errcode = '22023';
  end if;
  delete from same_room_group_members where group_id = p_group_id;
  insert into same_room_group_members(group_id, photo_id, position)
  select p_group_id, photo_id, ordinality::int
  from unnest(p_photo_ids) with ordinality members(photo_id, ordinality);
  update same_room_groups set updated_at = now() where id = p_group_id;
end;
$$;

revoke all on function is_current_logical_photo(uuid, uuid) from public, authenticated;
revoke all on function apply_room_proposal_decisions(uuid, uuid, jsonb) from public, authenticated;
revoke all on function replace_same_room_group_members(uuid, uuid, uuid[]) from public, authenticated;
grant execute on function apply_room_proposal_decisions(uuid, uuid, jsonb) to service_role;
grant execute on function replace_same_room_group_members(uuid, uuid, uuid[]) to service_role;
