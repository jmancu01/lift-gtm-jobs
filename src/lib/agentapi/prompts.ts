import type { Lead } from "../supabase/types.js";

/**
 * Single-turn research brief sent to the scout agent. Pre-seeds everything we
 * already know about both the *selling* company (our customer) and the target
 * lead inside <company-context> + <lead-context> blocks so scout can skip its
 * opening SELECTs. Contract: docs/AGENTAPI_CLIENT_CONTRACT.md (scout section).
 */
export function buildScoutPrompt(
  lead: Lead,
  company: { name: string; description: string | null },
): string {
  const leadContext = {
    lead_id: lead.id,
    email: lead.email,
    first_name: lead.first_name,
    last_name: lead.last_name,
    title: lead.title,
    company_name: lead.company_name,
    company_domain: lead.company_domain,
    linkedin_url: lead.linkedin_url,
    industry: lead.industry,
    employee_count: lead.employee_count,
    persona_hint: lead.persona_type,
  };
  const companyContext = {
    name: company.name,
    description: company.description,
  };
  return [
    "<company-context>",
    JSON.stringify(companyContext, null, 2),
    "</company-context>",
    "",
    "<lead-context>",
    JSON.stringify(leadContext, null, 2),
    "</lead-context>",
    "",
    "Research this lead.",
  ].join("\n");
}
