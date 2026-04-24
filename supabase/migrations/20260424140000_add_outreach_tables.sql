-- Outreach schema per docs/outreach-functions.md §4.
-- companies: holds the HeyReach connect-request campaign mapping and
--   sender account ID used by compose-and-send.
-- leads: stable HeyReach identifiers populated by Make.com on webhook
--   fire (heyreach_lead_id on connection_request_accepted;
--   heyreach_conversation_id on first reply/send event).
-- lead_messages: outbound/inbound message log, authoritative "have we
--   already sent" signal for the first_dm bucket.
alter table public.companies
  add column heyreach_conn_req_campaigns jsonb,
  add column heyreach_linkedin_account_id bigint;

alter table public.leads
  add column heyreach_lead_id text,
  add column heyreach_conversation_id text;

create table public.lead_messages (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null references public.leads(id) on delete cascade,
  channel             text not null check (channel in ('linkedin','email','phone')),
  direction           text not null check (direction in ('outbound','inbound')),
  content             text not null,
  source_system       text not null,
  external_message_id text,
  batch_id            text,
  input_type          text check (input_type in ('first_dm','reply')),
  copy_source         text check (copy_source in ('scout_passthrough','override')),
  intent              text,
  created_at          timestamptz not null default now()
);

create index lead_messages_lead_idx
  on public.lead_messages (lead_id, created_at desc);

create index lead_messages_outbound_idx
  on public.lead_messages (lead_id, created_at desc)
  where direction = 'outbound';

alter table public.lead_messages enable row level security;

create policy "Authenticated users can select lead_messages"
  on public.lead_messages for select to authenticated using (true);

create policy "Authenticated users can insert lead_messages"
  on public.lead_messages for insert to authenticated with check (true);

create policy "Authenticated users can update lead_messages"
  on public.lead_messages for update to authenticated using (true) with check (true);

create policy "Authenticated users can delete lead_messages"
  on public.lead_messages for delete to authenticated using (true);
