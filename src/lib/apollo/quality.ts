import type { IcpConfig } from "../supabase/types.js";
import type { ApolloEnrichedPerson } from "./types.js";

export interface QualityFilterResult {
  passed: boolean;
  reason?: string;
}

export function qualityFilter(
  person: ApolloEnrichedPerson,
  icp: IcpConfig,
): QualityFilterResult {
  if (!person.email || !person.id) {
    return { passed: false, reason: "no_email_or_id" };
  }
  if (person.email_status !== "verified") {
    return {
      passed: false,
      reason: `email_status_${person.email_status || "unknown"}`,
    };
  }
  if (icp.reject_extrapolated && person.extrapolated_email_confidence) {
    return { passed: false, reason: "extrapolated_email" };
  }
  if (person.last_refreshed_at) {
    const refreshedDate = new Date(person.last_refreshed_at);
    const daysSinceRefresh =
      (Date.now() - refreshedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceRefresh > icp.max_stale_days) {
      return { passed: false, reason: `stale_data_over_${icp.max_stale_days}_days` };
    }
  }
  return { passed: true };
}
