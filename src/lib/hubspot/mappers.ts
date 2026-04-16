import type { Lead } from "../supabase/types.js";

export const INDUSTRY_MAP: Record<string, string> = {
  banking: "BANKING",
  insurance: "INSURANCE",
  "financial services": "FINANCIAL_SERVICES",
  "capital markets": "CAPITAL_MARKETS",
  "investment banking": "INVESTMENT_BANKING",
  "investment management": "INVESTMENT_MANAGEMENT",
  "venture capital": "VENTURE_CAPITAL_PRIVATE_EQUITY",
  accounting: "ACCOUNTING",
  "real estate": "REAL_ESTATE",
  "health care": "HOSPITAL_HEALTH_CARE",
  "information technology": "INFORMATION_TECHNOLOGY_AND_SERVICES",
  telecommunications: "TELECOMMUNICATIONS",
  retail: "RETAIL",
  manufacturing: "MECHANICAL_OR_INDUSTRIAL_ENGINEERING",
  consulting: "MANAGEMENT_CONSULTING",
};

export function mapIndustry(raw: string | null): string {
  const lower = (raw || "").toLowerCase();
  if (!lower) return "";
  return INDUSTRY_MAP[lower] || lower.toUpperCase().replace(/[\s&]+/g, "_");
}

export function contactPropertiesFromLead(lead: Lead): Record<string, string> {
  return {
    firstname: lead.first_name || "",
    lastname: lead.last_name || "",
    jobtitle: lead.title || "",
    company: lead.company_name || "",
    hs_linkedin_url: lead.linkedin_url || "",
    persona_type: lead.persona_type || "",
    icp_tier: lead.icp_tier || "",
    apollo_sync_date: new Date().toISOString(),
  };
}
