import type { IcpConfig, IcpPersona } from "../supabase/types.js";
import type { ApolloSearchFilters } from "./types.js";

export function buildFiltersFromIcp(
  icp: IcpConfig,
  persona: IcpPersona,
  page: number,
  perPage: number,
): ApolloSearchFilters {
  const filters: ApolloSearchFilters = {
    person_titles: persona.titles,
    contact_email_status: icp.contact_email_status,
    prospected_by_current_team: ["no"],
    per_page: perPage,
    page,
  };
  if (icp.person_locations?.length) {
    filters.person_locations = icp.person_locations;
  }
  if (icp.organization_industries?.length) {
    filters.organization_industries = icp.organization_industries;
  }
  if (icp.organization_num_employees_ranges?.length) {
    filters.organization_num_employees_ranges =
      icp.organization_num_employees_ranges;
  }
  if (icp.person_seniorities?.length) {
    filters.person_seniorities = icp.person_seniorities;
  }
  if (icp.q_organization_domains_list?.length) {
    filters.q_organization_domains_list = icp.q_organization_domains_list;
  }
  if (icp.q_keywords) filters.q_keywords = icp.q_keywords;
  return filters;
}
