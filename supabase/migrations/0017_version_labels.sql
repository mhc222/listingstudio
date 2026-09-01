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

comment on column output_versions.version_label is
  'Optional user-facing name. Naming never changes review state or the approved final pointer.';
comment on table variation_requests is
  'Immutable idempotency record for 2-4 independent siblings branched from one exact output version.';
comment on column file_groups.requested_output_label is
  'Label copied onto the immutable output produced for one variation sibling.';
