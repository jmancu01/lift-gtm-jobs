-- Phone columns populated asynchronously by the Apollo waterfall webhook
-- (webhook-apollo edge function) when discover-leads enables reveal_phone_number
-- and run_waterfall_phone on bulk_match.
alter table public.leads
  add column if not exists phone              text,
  add column if not exists phone_source       text,
  add column if not exists phone_type         text,
  add column if not exists phone_status       text,
  add column if not exists phone_revealed_at  timestamptz;
