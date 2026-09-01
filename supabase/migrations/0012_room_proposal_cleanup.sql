-- Phase 46 browser QA found that the original no-key acceptance branch could
-- delete unrelated one-member proposed groups. Narrow cleanup to only the
-- group the current photo just left. The API remains backward-compatible with
-- the initially applied 0011 function until this migration is run.

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
  v_previous_group_id uuid;
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
      select group_id into v_previous_group_id
      from same_room_group_members where photo_id = v_proposal.photo_id;
      delete from same_room_group_members where photo_id = v_proposal.photo_id;
      if v_previous_group_id is not null and (
        select count(*) from same_room_group_members where group_id = v_previous_group_id
      ) < 2 then
        delete from same_room_groups where id = v_previous_group_id;
      end if;
    end if;

    update room_proposals set decision = 'accepted', review_state = 'confirmed',
      accepted_room_id = v_room_id, decided_at = coalesce(decided_at, now()), updated_at = now()
    where id = v_proposal.id;
    v_accepted := v_accepted + 1;
  end loop;
  return query select v_accepted, v_deferred;
end;
$$;

revoke all on function apply_room_proposal_decisions(uuid, uuid, jsonb) from public, authenticated;
grant execute on function apply_room_proposal_decisions(uuid, uuid, jsonb) to service_role;
