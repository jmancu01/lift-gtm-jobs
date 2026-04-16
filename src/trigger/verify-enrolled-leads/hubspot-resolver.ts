import { getCompanyById } from "../../lib/supabase/index.js";
import {
  createHubSpotClient,
  type HubSpotClient,
} from "../../lib/hubspot/index.js";

/**
 * Resolves a per-company HubSpot client, caching by companyId within one
 * batch invocation so we don't re-fetch the company row for every lead.
 * Returns null if the company has no hubspot_access_token configured.
 */
export function makeHubSpotResolver(): (
  companyId: string,
) => Promise<HubSpotClient | null> {
  const cache = new Map<string, HubSpotClient | null>();
  return async (companyId: string) => {
    if (cache.has(companyId)) return cache.get(companyId)!;
    const company = await getCompanyById(companyId);
    const client = company.hubspot_access_token
      ? createHubSpotClient(company.hubspot_access_token)
      : null;
    cache.set(companyId, client);
    return client;
  };
}
