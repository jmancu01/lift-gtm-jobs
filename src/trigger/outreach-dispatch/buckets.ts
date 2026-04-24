import {
  createSupabaseClient,
  getResearchSummariesByLeadIds,
  type Lead,
  type ResearchSummary,
} from "../../lib/supabase/index.js";

export interface ColdCandidate {
  lead: Lead;
}

export interface FirstDmCandidate {
  lead: Lead;
  research: ResearchSummary;
  connectionAcceptedAt: string;
}

export interface ReplyCandidate {
  lead: Lead;
  research: ResearchSummary;
  latestReplyAt: string;
}

const CONNECTION_ACCEPTED_EVENT = "connection_request_accepted";
const REPLY_EVENT_TYPES = [
  "message_reply_received",
  "message_replied",
  "every_message_reply_received",
];

/**
 * Leads qualified and ready to enroll into a HeyReach connection-request
 * campaign. Skipped for companies that don't have a
 * heyreach_conn_req_campaigns mapping or whose mapping doesn't cover the
 * lead's persona_type.
 */
export async function fetchColdBucket(
  companyId: string,
  personaKeys: string[],
  limit: number,
): Promise<ColdCandidate[]> {
  if (personaKeys.length === 0) return [];
  const client = createSupabaseClient();
  const { data, error } = await client
    .from("leads")
    .select("*")
    .eq("company_id", companyId)
    .eq("funnel_stage", "qualified")
    .eq("qualification_status", "ready")
    .is("heyreach_lead_id", null)
    .in("persona_type", personaKeys)
    .order("qualified_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`cold bucket query failed: ${error.message}`);
  return ((data ?? []) as Lead[]).map((lead) => ({ lead }));
}

/**
 * Leads that accepted a connection request and we haven't DM'd yet.
 * Requires research_summaries.personalized_linkedin_dm so the agent has a
 * draft to evaluate; otherwise they wait for scout to backfill.
 */
export async function fetchFirstDmBucket(
  companyId: string,
  limit: number,
): Promise<FirstDmCandidate[]> {
  const client = createSupabaseClient();

  // Oldest connection_request_accepted event per lead. A lead can appear
  // multiple times if HeyReach reports duplicates; we dedupe client-side by
  // keeping the earliest timestamp.
  const { data: events, error: eventsErr } = await client
    .from("lead_events")
    .select("lead_id, created_at")
    .eq("event_type", CONNECTION_ACCEPTED_EVENT)
    .order("created_at", { ascending: true })
    .limit(1_000);
  if (eventsErr) {
    throw new Error(`first_dm events query failed: ${eventsErr.message}`);
  }
  const earliestByLead = new Map<string, string>();
  for (const row of events ?? []) {
    if (!earliestByLead.has(row.lead_id)) {
      earliestByLead.set(row.lead_id, row.created_at);
    }
  }
  if (earliestByLead.size === 0) return [];

  const candidateIds = Array.from(earliestByLead.keys());

  // Anti-join against outbound lead_messages: anyone we already DM'd is
  // ineligible, regardless of direction the conversation has gone since.
  const { data: sent, error: sentErr } = await client
    .from("lead_messages")
    .select("lead_id")
    .eq("direction", "outbound")
    .in("lead_id", candidateIds);
  if (sentErr) {
    throw new Error(`first_dm messages query failed: ${sentErr.message}`);
  }
  const alreadySent = new Set((sent ?? []).map((r) => r.lead_id));
  const remaining = candidateIds.filter((id) => !alreadySent.has(id));
  if (remaining.length === 0) return [];

  const { data: leads, error: leadsErr } = await client
    .from("leads")
    .select("*")
    .eq("company_id", companyId)
    .in("id", remaining)
    .not("heyreach_conversation_id", "is", null)
    .limit(limit);
  if (leadsErr) {
    throw new Error(`first_dm leads query failed: ${leadsErr.message}`);
  }
  const pool = (leads ?? []) as Lead[];
  if (pool.length === 0) return [];

  const researchByLead = await getResearchSummariesByLeadIds(
    pool.map((l) => l.id),
  );

  const out: FirstDmCandidate[] = [];
  for (const lead of pool) {
    const research = researchByLead.get(lead.id);
    if (!research || !research.personalized_linkedin_dm) continue;
    const acceptedAt = earliestByLead.get(lead.id);
    if (!acceptedAt) continue;
    out.push({ lead, research, connectionAcceptedAt: acceptedAt });
  }
  return out.sort((a, b) =>
    a.connectionAcceptedAt.localeCompare(b.connectionAcceptedAt),
  );
}

/**
 * Leads whose most recent inbound reply event is newer than our most
 * recent outbound message (so the lead is owed a reply from us).
 */
export async function fetchReplyBucket(
  companyId: string,
  limit: number,
): Promise<ReplyCandidate[]> {
  const client = createSupabaseClient();

  const { data: replyEvents, error: eventsErr } = await client
    .from("lead_events")
    .select("lead_id, created_at")
    .in("event_type", REPLY_EVENT_TYPES)
    .order("created_at", { ascending: false })
    .limit(2_000);
  if (eventsErr) {
    throw new Error(`reply events query failed: ${eventsErr.message}`);
  }
  const latestReplyByLead = new Map<string, string>();
  for (const row of replyEvents ?? []) {
    // Rows come newest-first, so the first entry per lead wins.
    if (!latestReplyByLead.has(row.lead_id)) {
      latestReplyByLead.set(row.lead_id, row.created_at);
    }
  }
  if (latestReplyByLead.size === 0) return [];

  const candidateIds = Array.from(latestReplyByLead.keys());

  const { data: outbounds, error: outErr } = await client
    .from("lead_messages")
    .select("lead_id, created_at")
    .eq("direction", "outbound")
    .in("lead_id", candidateIds)
    .order("created_at", { ascending: false });
  if (outErr) {
    throw new Error(`reply outbound query failed: ${outErr.message}`);
  }
  const latestOutboundByLead = new Map<string, string>();
  for (const row of outbounds ?? []) {
    if (!latestOutboundByLead.has(row.lead_id)) {
      latestOutboundByLead.set(row.lead_id, row.created_at);
    }
  }

  const oweReply = candidateIds.filter((id) => {
    const reply = latestReplyByLead.get(id);
    if (!reply) return false;
    const out = latestOutboundByLead.get(id);
    return !out || reply > out;
  });
  if (oweReply.length === 0) return [];

  const { data: leads, error: leadsErr } = await client
    .from("leads")
    .select("*")
    .eq("company_id", companyId)
    .in("id", oweReply)
    .not("heyreach_conversation_id", "is", null)
    .limit(limit);
  if (leadsErr) {
    throw new Error(`reply leads query failed: ${leadsErr.message}`);
  }
  const pool = (leads ?? []) as Lead[];
  if (pool.length === 0) return [];

  const researchByLead = await getResearchSummariesByLeadIds(
    pool.map((l) => l.id),
  );

  const out: ReplyCandidate[] = [];
  for (const lead of pool) {
    const research = researchByLead.get(lead.id);
    if (!research) continue;
    const latestReplyAt = latestReplyByLead.get(lead.id);
    if (!latestReplyAt) continue;
    out.push({ lead, research, latestReplyAt });
  }
  return out.sort((a, b) => a.latestReplyAt.localeCompare(b.latestReplyAt));
}
