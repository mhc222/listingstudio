-- Phase 8: auto-QA retry cap enforced as a state transition (one auto-retry
-- per rework cycle; reset when the user starts a new rework).
alter table file_groups add column qa_retry_count int not null default 0;
