-- Multi-tenant foundation: companies + icp_configs, scope leads by company_id.
-- Existing 2909 leads belong to Bramble. LIFT is seeded as the platform's
-- default fallback company — new inserts without an explicit company_id land
-- there via the column DEFAULT. company_id stays nullable for flexibility.

-- 1. companies
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  hubspot_access_token text,
  hubspot_portal_id text,
  apollo_contact_stage_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.companies enable row level security;

-- 2. icp_configs (versioned; one active per company)
create table if not exists public.icp_configs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version int not null default 1,
  is_active boolean not null default true,
  person_locations text[],
  organization_industries text[],
  organization_num_employees_ranges text[],
  person_seniorities text[],
  contact_email_status text not null default 'verified',
  q_organization_domains_list text[],
  q_keywords text,
  personas jsonb not null,
  max_stale_days int not null default 90,
  reject_extrapolated boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, version)
);

create unique index if not exists icp_configs_one_active_per_company
  on public.icp_configs (company_id)
  where is_active = true;

alter table public.icp_configs enable row level security;

-- 3. Seed both companies up front so we can reference their ids.
--    hubspot_access_token left NULL — set manually after this migration, e.g.:
--      update public.companies
--      set hubspot_access_token = '<paste HUBSPOT_ACCESS_TOKEN env value>'
--      where slug = 'bramble';
insert into public.companies (name, slug, apollo_contact_stage_id)
values
  ('Bramble', 'bramble', '68879d5da405a2000d7ae7ae'),
  ('LIFT', 'lift', null)
on conflict (slug) do nothing;

-- 4. Seed Bramble's ICP (the current hardcoded config from the edge function).
insert into public.icp_configs (
  company_id,
  personas,
  person_locations,
  organization_industries,
  organization_num_employees_ranges
)
select
  c.id,
  '[
    {
      "name": "Transformation",
      "titles": [
        "VP Transformation",
        "Vice President Transformation",
        "SVP Transformation",
        "EVP Transformation",
        "Director Transformation",
        "Head of Transformation",
        "General Manager Transformation",
        "Executive General Manager Transformation"
      ]
    },
    {
      "name": "Operations",
      "titles": [
        "CCO","COO","CEO",
        "VP Claims","Vice President Claims","SVP Claims","EVP Claims",
        "Director Claims","Head of Claims","General Manager Claims",
        "Executive General Manager Claims",
        "VP Operations","Vice President Operations","SVP Operations","EVP Operations",
        "Director Operations","Head of Operations","General Manager Operations",
        "Executive General Manager Operations",
        "VP Underwriting","Vice President Underwriting","SVP Underwriting","EVP Underwriting",
        "Director Underwriting","Head of Underwriting","General Manager Underwriting",
        "Executive General Manager Underwriting"
      ]
    },
    {
      "name": "Finance",
      "titles": [
        "CFO",
        "VP Finance","Vice President Finance","SVP Finance","EVP Finance",
        "Director Finance","Head of Finance","General Manager Finance",
        "Executive General Manager Finance",
        "VP Analytics","Vice President Analytics","SVP Analytics","EVP Analytics",
        "Director Analytics","Head of Analytics","General Manager Analytics",
        "Executive General Manager Analytics",
        "VP Data Reporting","Vice President Data Reporting","SVP Data Reporting","EVP Data Reporting",
        "Director Data Reporting","Head of Data Reporting","General Manager Data Reporting",
        "Executive General Manager Data Reporting"
      ]
    }
  ]'::jsonb,
  array['United States','Canada','Australia','New Zealand','United Kingdom','Ireland'],
  array['insurance','financial services'],
  array['1001,5000','5001,10000','10001,']
from public.companies c
where c.slug = 'bramble'
  and not exists (
    select 1 from public.icp_configs ic
    where ic.company_id = c.id and ic.version = 1
  );

-- 5. Extend leads with company_id. Nullable by design; a BEFORE INSERT trigger
--    slots NULL inserts into LIFT (Postgres disallows subqueries in column
--    DEFAULTs, so a trigger is the canonical way to resolve the id at runtime).
alter table public.leads
  add column if not exists company_id uuid references public.companies(id);

create index if not exists idx_leads_company_id on public.leads (company_id);

create or replace function public.set_lead_default_company()
returns trigger
language plpgsql
as $$
begin
  if new.company_id is null then
    new.company_id := (select id from public.companies where slug = 'lift');
  end if;
  return new;
end;
$$;

drop trigger if exists set_lead_default_company_trg on public.leads;
create trigger set_lead_default_company_trg
  before insert on public.leads
  for each row execute function public.set_lead_default_company();

-- 6. Backfill the 2909 existing leads to Bramble (they were all discovered
--    against Bramble's ICP in the edge function).
update public.leads
set company_id = (select id from public.companies where slug = 'bramble')
where company_id is null;

-- 7. Swap email uniqueness: global -> per-company. This allows the same
--    email to exist under different companies (e.g. Bramble + LIFT) without
--    conflict, which is the whole point of multi-tenancy.
alter table public.leads drop constraint if exists leads_email_key;
alter table public.leads
  add constraint leads_company_email_unique unique (company_id, email);
