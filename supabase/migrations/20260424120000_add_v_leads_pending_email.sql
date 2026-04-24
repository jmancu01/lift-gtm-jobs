DROP VIEW IF EXISTS v_emailed_leads_recent;

CREATE OR REPLACE VIEW v_leads_pending_email AS
SELECT DISTINCT l.*
FROM leads l
WHERE l.created_at >= NOW() - INTERVAL '14 days'
  AND NOT EXISTS (
    SELECT 1 FROM lead_events e
    WHERE e.lead_id = l.id AND e.event_type = 'email_sent'
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM lead_events e
      WHERE e.lead_id = l.id AND e.event_type = 'connection_request_sent'
    )
    OR EXISTS (
      SELECT 1 FROM lead_events e
      WHERE e.lead_id = l.id
        AND e.event_type = 'connection_request_sent'
        AND e.created_at >= NOW() - INTERVAL '2 days'
    )
  );

COMMENT ON VIEW v_leads_pending_email IS
  'Leads created in the last 14 days with no email_sent event, and either no connection_request_sent event or one sent within the last 2 days.';
