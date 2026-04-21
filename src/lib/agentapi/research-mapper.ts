import type { NewLeadAiResearch } from "../supabase/types.js";
import { scoutFitToTier } from "./types.js";
import type { ScoutPayload } from "./types.js";

export function researchRowFromScout(
  scout: ScoutPayload,
  context: { leadId: string; companyId: string; runId: string },
): NewLeadAiResearch {
  return {
    lead_id: context.leadId,
    company_id: context.companyId,
    fit_tag: scoutFitToTier(scout.hubspot_properties.lift_ai_fit_tag),
    fit_justification: scout.fit_justification,
    confidence: scout.confidence,
    research_quality: scout.research_quality,
    summary: scout.hubspot_properties.lift_ai_summary,
    signals: scout.hubspot_properties.lift_ai_signals,
    phone: scout.phone_number,
    phone_source: scout.phone_source,
    talking_points: scout.talking_points,
    pain_points: scout.pain_points,
    recent_activity: scout.recent_activity,
    sources: scout.sources,
    company_summary: scout.company_summary || null,
    industry: scout.industry || null,
    company_size: scout.company_size || null,
    run_id: context.runId,
  };
}
