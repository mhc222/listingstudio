-- Phase 48: account-owned reusable edit presets and deterministic defaults.
-- Jobs keep copied edit chains/snapshots, so later preset rename/delete cannot
-- rewrite historical work.

create table edit_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  edit_chain jsonb not null check (jsonb_typeof(edit_chain) = 'array' and jsonb_array_length(edit_chain) between 1 and 8),
  size_preset text not null default 'original' check (size_preset in ('original', 'under_10mb', 'under_5mb')),
  settings_summary jsonb not null check (jsonb_typeof(settings_summary) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index edit_presets_user_name_unique on edit_presets(user_id, lower(btrim(name)));

create table edit_preset_defaults (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  preset_id uuid not null references edit_presets(id) on delete cascade,
  scope_type text not null check (scope_type in ('account', 'listing', 'room')),
  listing_id uuid references listings(id) on delete cascade,
  room_id uuid references rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'account' and listing_id is null and room_id is null) or
    (scope_type = 'listing' and listing_id is not null and room_id is null) or
    (scope_type = 'room' and listing_id is not null and room_id is not null)
  )
);

create unique index edit_preset_defaults_account_unique
  on edit_preset_defaults(user_id) where scope_type = 'account';
create unique index edit_preset_defaults_listing_unique
  on edit_preset_defaults(user_id, listing_id) where scope_type = 'listing';
create unique index edit_preset_defaults_room_unique
  on edit_preset_defaults(user_id, room_id) where scope_type = 'room';

create or replace function validate_edit_preset_default()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from edit_presets p where p.id = new.preset_id and p.user_id = new.user_id) then
    raise exception 'preset must belong to default owner';
  end if;
  if new.listing_id is not null and not exists (
    select 1 from listings l where l.id = new.listing_id and l.user_id = new.user_id
  ) then
    raise exception 'listing must belong to default owner';
  end if;
  if new.room_id is not null and not exists (
    select 1 from rooms r join listings l on l.id = r.listing_id
    where r.id = new.room_id and r.listing_id = new.listing_id and l.user_id = new.user_id
  ) then
    raise exception 'room must belong to the selected listing and owner';
  end if;
  return new;
end;
$$;

create trigger edit_preset_defaults_validate
before insert or update on edit_preset_defaults
for each row execute function validate_edit_preset_default();

create or replace function touch_edit_preset_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger edit_presets_touch_updated_at
before update on edit_presets
for each row execute function touch_edit_preset_updated_at();
create trigger edit_preset_defaults_touch_updated_at
before update on edit_preset_defaults
for each row execute function touch_edit_preset_updated_at();

alter table edit_presets enable row level security;
alter table edit_preset_defaults enable row level security;

create policy "own edit presets" on edit_presets for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own edit preset defaults" on edit_preset_defaults for all to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from edit_presets p where p.id = preset_id and p.user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from edit_presets p where p.id = preset_id and p.user_id = auth.uid())
    and (listing_id is null or exists (
      select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
    ))
    and (room_id is null or exists (
      select 1 from rooms r join listings l on l.id = r.listing_id
      where r.id = room_id and r.listing_id = listing_id and l.user_id = auth.uid()
    ))
  );

comment on table edit_presets is 'Validated reusable edit-chain definitions copied into immutable Job scope at submission.';
comment on table edit_preset_defaults is 'Optional account, listing, or room default relationship; resolution precedence is room, listing, account.';
