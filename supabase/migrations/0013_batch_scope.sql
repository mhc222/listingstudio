-- Phase 47: immutable, retry-safe batch target scope.
-- Historical jobs remain nullable; every job created by the Phase 47 route
-- writes the exact server-validated target snapshot at insert time.

alter table jobs
  add column target_request_id uuid,
  add column target_snapshot jsonb;

alter table jobs
  add constraint jobs_target_snapshot_object
  check (target_snapshot is null or jsonb_typeof(target_snapshot) = 'object');

create unique index jobs_listing_target_request_unique
  on jobs(listing_id, target_request_id)
  where target_request_id is not null;

create or replace function prevent_job_target_scope_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.target_snapshot is not null
     and old.target_snapshot is distinct from new.target_snapshot then
    raise exception 'job target scope is immutable';
  end if;

  if old.target_request_id is not null
     and old.target_request_id is distinct from new.target_request_id then
    raise exception 'job target request identity is immutable';
  end if;

  return new;
end;
$$;

create trigger jobs_target_scope_immutable
before update of target_snapshot, target_request_id on jobs
for each row execute function prevent_job_target_scope_mutation();

comment on column jobs.target_request_id is
  'Client retry identity for one exact server-validated submission scope.';
comment on column jobs.target_snapshot is
  'Immutable Phase 47 snapshot of ordered logical targets, room/group identity, per-target edit chains, output size, and generation count.';
