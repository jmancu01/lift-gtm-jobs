-- Pilot-company configuration for the outreach-dispatch cron.
-- Per docs/outreach-functions.md §10.3. Not a migration — values are
-- per-environment and change as personas / HeyReach campaigns evolve.
--
-- Run once per pilot company, after the outreach tables migration
-- (20260424140000_add_outreach_tables.sql) has been applied.
--
-- Prerequisites to gather before running:
--   1. The company's `slug` in `companies` (e.g. 'lift').
--   2. The LinkedIn account ID HeyReach will send from. Find it via
--      MCP: mcp__heyreach__get_all_linked_in_accounts — use the `id`
--      field of the account that owns the connection-request campaigns.
--   3. For each persona_type we want to enroll cold, the HeyReach
--      campaign ID running that persona's connection requests. Find
--      via MCP: mcp__heyreach__get_all_campaigns and match on campaign
--      name / sender. Persona keys must match `leads.persona_type`
--      strings exactly (the cold bucket filters on
--      `persona_type IN (keys of heyreach_conn_req_campaigns)`).
--
-- Leave `heyreach_linkedin_account_id` NULL to keep a company out of
-- the dispatch cron entirely (outreach-dispatch/index.ts filters these
-- companies out before bucketing).

-- Replace the placeholders below, then run.

update companies
set
  heyreach_linkedin_account_id = 0,              -- e.g. 178234567
  heyreach_conn_req_campaigns  = '{
    "persona_name_1": 0,
    "persona_name_2": 0
  }'::jsonb
where slug = 'lift';                             -- pilot company slug

-- Verify:
select
  slug,
  heyreach_linkedin_account_id,
  heyreach_conn_req_campaigns
from companies
where slug = 'lift';
