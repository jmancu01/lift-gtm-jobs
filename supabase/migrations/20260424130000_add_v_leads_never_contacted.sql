CREATE OR REPLACE VIEW v_leads_never_contacted AS
SELECT l.*
FROM leads l
WHERE NOT EXISTS (
  SELECT 1 FROM lead_events e
  WHERE e.lead_id = l.id
    AND e.event_type IN ('email_sent', 'connection_request_sent')
);

COMMENT ON VIEW v_leads_never_contacted IS
  'Leads with no email_sent and no connection_request_sent events ever — outreach has not been attempted.';
