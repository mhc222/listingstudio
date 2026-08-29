-- Phase 20: Terms of Use acceptance. One row per (user, terms version) —
-- acceptance history kept as evidence (terms §27), never overwritten.

create table terms_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  version int not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

alter table terms_acceptances enable row level security;

create policy "own acceptances" on terms_acceptances for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
