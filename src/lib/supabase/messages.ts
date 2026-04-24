import { createSupabaseClient } from "./client.js";
import type { LeadMessage, NewLeadMessage, ResearchSummary } from "./types.js";

export async function insertLeadMessage(
  message: NewLeadMessage,
): Promise<LeadMessage> {
  const client = createSupabaseClient();
  const { data, error } = await client
    .from("lead_messages")
    .insert(message)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to insert lead_message: ${error?.message ?? "no data"}`,
    );
  }
  return data as LeadMessage;
}

export async function getResearchSummariesByLeadIds(
  leadIds: string[],
): Promise<Map<string, ResearchSummary>> {
  if (leadIds.length === 0) return new Map();
  const client = createSupabaseClient();
  const { data, error } = await client
    .from("research_summaries")
    .select("*")
    .in("lead_id", leadIds);
  if (error) {
    throw new Error(`Failed to fetch research_summaries: ${error.message}`);
  }
  const map = new Map<string, ResearchSummary>();
  for (const row of (data ?? []) as ResearchSummary[]) {
    if (row.lead_id) map.set(row.lead_id, row);
  }
  return map;
}
