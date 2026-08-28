-- Phase 3: orchestration support.

alter table file_groups add column retry_count int not null default 0;
alter table file_groups add column last_error text;
create index file_groups_fal_request_idx on file_groups(fal_request_id);

-- cost totals keep fractional cents (rates like 2.1c/call)
alter table jobs alter column total_cost_cents type numeric;

create or replace function increment_job_cost(p_job_id uuid, p_cents numeric)
returns void language sql security definer as $$
  update jobs set total_cost_cents = total_cost_cents + p_cents where id = p_job_id;
$$;

-- live job status in the UI
alter publication supabase_realtime add table jobs, file_groups, output_versions;
