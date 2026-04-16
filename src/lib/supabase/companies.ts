import { createSupabaseClient } from "./client.js";
import type { Company, IcpConfig } from "./types.js";

export async function getActiveCompanies(): Promise<Company[]> {
  const client = createSupabaseClient();
  const { data, error } = await client
    .from("companies")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to fetch active companies: ${error.message}`);
  return (data ?? []) as Company[];
}

export async function getCompanyById(id: string): Promise<Company> {
  const client = createSupabaseClient();
  const { data, error } = await client
    .from("companies")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) {
    throw new Error(`Company ${id} not found: ${error?.message ?? "no data"}`);
  }
  return data as Company;
}

export async function getActiveIcp(companyId: string): Promise<IcpConfig> {
  const client = createSupabaseClient();
  const { data, error } = await client
    .from("icp_configs")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch ICP: ${error.message}`);
  if (!data) throw new Error(`No active ICP config for company ${companyId}`);
  return data as IcpConfig;
}
