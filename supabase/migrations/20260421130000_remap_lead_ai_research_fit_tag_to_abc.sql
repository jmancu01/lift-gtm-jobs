-- Remap fit_tag vocabulary from scout.v1's High/Medium/Low to the GTM
-- engine's A/B/C tiering. The scout agent still returns High/Medium/Low
-- per schema contract; translation happens in the runner (mappers).
alter table public.lead_ai_research
  drop constraint lead_ai_research_fit_tag_check;

alter table public.lead_ai_research
  add constraint lead_ai_research_fit_tag_check
  check (fit_tag in ('A','B','C'));
