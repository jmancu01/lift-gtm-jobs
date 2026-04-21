export { createHubSpotClient, type HubSpotClient } from "./client.js";
export {
  INDUSTRY_MAP,
  mapIndustry,
  contactPropertiesFromLead,
  contactPropertiesFromScout,
} from "./mappers.js";
export type { HubSpotContact, HubSpotCompany, HubSpotDeal } from "./types.js";
