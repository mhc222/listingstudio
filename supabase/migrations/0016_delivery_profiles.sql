-- Phase 51: account-owned, server-validated delivery profiles.
-- Profiles describe reproducible package output only; they never choose finals.

create table delivery_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  file_format text not null check (file_format in ('jpeg', 'webp', 'png')),
  max_width int check (max_width is null or max_width between 320 and 12000),
  max_height int check (max_height is null or max_height between 320 and 12000),
  quality int not null check (quality between 35 and 100),
  max_bytes int check (max_bytes is null or max_bytes between 262144 and 20971520),
  disclosure_mode text not null
    check (disclosure_mode in ('watermark', 'companion', 'watermark_and_companion')),
  naming_pattern text not null
    check (naming_pattern in ('sequence_room', 'sequence_original', 'original')),
  ordering text not null check (ordering in ('shoot', 'room')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_width is not null or max_height is not null or max_bytes is not null),
  check (file_format <> 'png' or max_bytes is null)
);

create unique index delivery_profiles_user_name_unique
  on delivery_profiles(user_id, lower(btrim(name)));

create or replace function touch_delivery_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger delivery_profiles_touch_updated_at
before update on delivery_profiles
for each row execute function touch_delivery_profile_updated_at();

alter table delivery_profiles enable row level security;

-- Authenticated clients may inspect only their profiles. All mutations go
-- through authenticated server routes and a service-role write after strict
-- validation, matching the saved-edit-preset boundary.
create policy "read own delivery profiles" on delivery_profiles for select to authenticated
  using (user_id = auth.uid());

comment on table delivery_profiles is
  'Validated account-owned output recipes for approved-final delivery packages; profiles never select or move a photo final.';
