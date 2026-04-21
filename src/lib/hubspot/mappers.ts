import { scoutFitToTier } from "../agentapi/types.js";
import type { ScoutPayload } from "../agentapi/types.js";
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

/**
 * Maps scout.v1 output to the HubSpot contact properties the agent itself
 * specifies in `hubspot_properties`, plus the core ICP fields we derive from
 * `fit_probability` so existing reports keyed on `icp_tier`/`qualification_*`
 * keep working.
 */
export function contactPropertiesFromScout(
  scout: ScoutPayload,
): Record<string, string> {
  const tier = scoutFitToTier(scout.hubspot_properties.lift_ai_fit_tag);
  return {
    lift_ai_summary: scout.hubspot_properties.lift_ai_summary || "",
    lift_ai_fit_tag: tier,
    lift_ai_signals: scout.hubspot_properties.lift_ai_signals || "",
    lift_ai_phone: scout.hubspot_properties.lift_ai_phone || "",
    icp_tier: tier,
    icp_score: Math.round((scout.confidence ?? 0) * 100).toString(),
    qualification_status: tier === "C" ? "suppressed" : "ready",
    qualification_date: new Date().toISOString(),
  };
}
