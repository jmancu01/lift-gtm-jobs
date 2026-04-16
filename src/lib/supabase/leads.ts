import { createSupabaseClient } from "./client.js";
import type { Lead } from "./types.js";

export interface GetLeadsOptions {
  companyId?: string;
  qualificationStatus?: string;
  limit?: number;
}

export async function getLeadsByStage(
  stage: string,
  options?: GetLeadsOptions,
): Promise<Lead[]> {
  const client = createSupabaseClient();
  let query = client.from("leads").select("*").eq("funnel_stage", stage);
  if (options?.companyId) query = query.eq("company_id", options.companyId);
  if (options?.qualificationStatus) {
    query = query.eq("qualification_status", options.qualificationStatus);
  }
  if (options?.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch leads: ${error.message}`);
  return (data ?? []) as Lead[];
}

export async function updateLead(id: string, data: Partial<Lead>): Promise<void> {
  const client = createSupabaseClient();
  const { error } = await client
    .from("leads")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to update lead: ${error.message}`);
}

export async function findExistingApolloIds(
  companyId: string,
  apolloIds: string[],
): Promise<Set<string>> {
  if (apolloIds.length === 0) return new Set();
  const client = createSupabaseClient();
  const { data, error } = await client
    .from("leads")
    .select("apollo_id")
    .eq("company_id", companyId)
    .in("apollo_id", apolloIds);
  if (error) throw new Error(`Failed to lookup apollo_ids: ${error.message}`);
  return new Set((data ?? []).map((row) => row.apollo_id as string));
}

export async function leadExistsByEmail(
  companyId: string,
  email: string,
): Promise<boolean> {
  const client = createSupabaseClient();
  const { data, error } = await client
    .from("leads")
    .select("id")
    .eq("company_id", companyId)
    .eq("email", email)
    .limit(1);
  if (error) throw new Error(`Failed to lookup email: ${error.message}`);
  return (data ?? []).length > 0;
}

export type NewLeadInput = Omit<Lead, "id" | "created_at" | "updated_at">;

export async function insertLead(lead: NewLeadInput): Promise<Lead> {
  const client = createSupabaseClient();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("leads")
    .insert({ ...lead, created_at: now, updated_at: now })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Failed to insert lead: ${error?.message ?? "no data"}`);
  }
  return data as Lead;
}
