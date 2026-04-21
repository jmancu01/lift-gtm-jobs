-- Rich research output from the AgentAPI scout agent (schema scout.v1).
-- One-to-many against leads: each run inserts a new row and marks the
-- previous current row as superseded_at. leads keeps the verdict columns
-- (icp_tier/score/qualification_status); this table keeps the narrative.
create table public.lead_ai_research (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references public.leads(id) on delete cascade,
  company_id         uuid not null references public.companies(id),

  fit_tag            text not null check (fit_tag in ('High','Medium','Low')),
  fit_justification  text not null,
  confidence         numeric(4,3) not null check (confidence between 0 and 1),
  research_quality   text not null check (research_quality in ('high','medium','low')),

  summary            text not null,
  signals            text not null,
  phone              text,
  phone_source       text,

  talking_points     jsonb not null default '[]'::jsonb,
  pain_points        jsonb not null default '[]'::jsonb,
  recent_activity    jsonb not null default '[]'::jsonb,
  sources            jsonb not null default '[]'::jsonb,

  company_summary    text,
  industry           text,
  company_size       text,

  run_id             uuid,
  schema_version     text not null default 'scout.v1',

  created_at         timestamptz not null default now(),
  superseded_at      timestamptz,

  -- phone_source required iff phone is present (mirrors scout.v1 allOf rule)
  constraint lead_ai_research_phone_pair
    check (
      (phone is null and phone_source is null)
      or (phone is not null and phone_source is not null)
    )
);

create index lead_ai_research_current_idx
  on public.lead_ai_research (lead_id)
  where superseded_at is null;

create index lead_ai_research_company_fit_idx
  on public.lead_ai_research (company_id, fit_tag, created_at desc)
  where superseded_at is null;

create index lead_ai_research_run_id_idx
  on public.lead_ai_research (run_id)
  where run_id is not null;

alter table public.lead_ai_research enable row level security;

create policy "Authenticated users can select lead_ai_research"
  on public.lead_ai_research for select to authenticated using (true);

create policy "Authenticated users can insert lead_ai_research"
  on public.lead_ai_research for insert to authenticated with check (true);

create policy "Authenticated users can update lead_ai_research"
  on public.lead_ai_research for update to authenticated using (true) with check (true);

create policy "Authenticated users can delete lead_ai_research"
  on public.lead_ai_research for delete to authenticated using (true);
