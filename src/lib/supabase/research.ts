import { createSupabaseClient } from "./client.js";
import type { LeadAiResearch, NewLeadAiResearch } from "./types.js";

/**
 * Inserts a new research row and supersedes the previous current row for the
 * same lead. Two round trips intentionally — the race window (two scout runs
 * for the same lead at the same time) is negligible, and a duplicate "current"
 * row is self-healing on the next run via the same supersede-then-insert flow.
 */
export async function insertLeadAiResearch(
  row: NewLeadAiResearch,
): Promise<LeadAiResearch> {
  const client = createSupabaseClient();

  const { error: supersedeError } = await client
    .from("lead_ai_research")
    .update({ superseded_at: new Date().toISOString() })
    .eq("lead_id", row.lead_id)
    .is("superseded_at", null);

  if (supersedeError) {
    throw new Error(
      `Failed to supersede previous research rows: ${supersedeError.message}`,
    );
  }

  const { data, error } = await client
    .from("lead_ai_research")
    .insert(row)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert lead_ai_research: ${error?.message ?? "no data"}`,
    );
  }
  return data as LeadAiResearch;
}

export async function getCurrentLeadAiResearch(
  leadId: string,
): Promise<LeadAiResearch | null> {
  const client = createSupabaseClient();
  const { data, error } = await client
    .from("lead_ai_research")
    .select("*")
    .eq("lead_id", leadId)
    .is("superseded_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch current research: ${error.message}`);
  }
  return (data ?? null) as LeadAiResearch | null;
}
