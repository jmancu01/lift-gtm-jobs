import type { HubSpotContact, HubSpotCompany } from "./types.js";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

const CONTACT_SEARCH_PROPERTIES = [
  "email",
  "firstname",
  "lastname",
  "jobtitle",
  "company",
  "phone",
  "hs_linkedin_url",
  "persona_type",
  "icp_score",
  "icp_tier",
  "qualification_status",
  "suppressed",
  "suppression_reason",
  "lifecyclestage",
  "hs_email_optout",
  "hs_email_bounce",
  "notes_last_contacted",
  "qualification_date",
  "hs_lead_status",
  "lift_ai_summary",
  "lift_ai_fit_tag",
  "lift_ai_signals",
  "lift_ai_phone",
];

const COMPANY_SEARCH_PROPERTIES = [
  "domain",
  "name",
  "industry",
  "numberofemployees",
  "lifecyclestage",
  "hs_current_customer",
];

class HubSpotClient {
  constructor(private readonly accessToken: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries = 3,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
    const options: RequestInit = { method, headers };
    if (body) options.body = JSON.stringify(body);

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(`${HUBSPOT_API_BASE}${path}`, options);
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(
          `HubSpot 429 (attempt ${attempt + 1}/${retries + 1}), waiting ${waitMs}ms`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (response.status === 204) return undefined as T;
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(
          `HubSpot API error (${response.status}): ${errorBody.message || response.statusText}`,
        );
      }
      return (await response.json()) as T;
    }
    throw new Error(`HubSpot rate limit exceeded after ${retries + 1} attempts`);
  }

  async searchContacts(email: string): Promise<HubSpotContact | null> {
    const response = await this.request<{ results: HubSpotContact[] }>(
      "POST",
      "/crm/v3/objects/contacts/search",
      {
        filterGroups: [
          {
            filters: [{ propertyName: "email", operator: "EQ", value: email }],
          },
        ],
        properties: CONTACT_SEARCH_PROPERTIES,
      },
    );
    return response.results[0] ?? null;
  }

  async getContact(id: string, properties: string[]): Promise<HubSpotContact> {
    const params = new URLSearchParams({ properties: properties.join(",") });
    return this.request<HubSpotContact>(
      "GET",
      `/crm/v3/objects/contacts/${id}?${params}`,
    );
  }

  async createContact(
    properties: Record<string, string>,
  ): Promise<HubSpotContact> {
    return this.request<HubSpotContact>("POST", "/crm/v3/objects/contacts", {
      properties,
    });
  }

  async updateContact(
    id: string,
    properties: Record<string, string>,
  ): Promise<void> {
    await this.request("PATCH", `/crm/v3/objects/contacts/${id}`, {
      properties,
    });
  }

  async searchCompanies(domain: string): Promise<HubSpotCompany | null> {
    const response = await this.request<{ results: HubSpotCompany[] }>(
      "POST",
      "/crm/v3/objects/companies/search",
      {
        filterGroups: [
          {
            filters: [{ propertyName: "domain", operator: "EQ", value: domain }],
          },
        ],
        properties: COMPANY_SEARCH_PROPERTIES,
      },
    );
    return response.results[0] ?? null;
  }

  async createCompany(
    properties: Record<string, string>,
  ): Promise<HubSpotCompany> {
    return this.request<HubSpotCompany>("POST", "/crm/v3/objects/companies", {
      properties,
    });
  }

  async associateContactToCompany(
    contactId: string,
    companyId: string,
  ): Promise<void> {
    await this.request(
      "PUT",
      `/crm/v4/objects/contacts/${contactId}/associations/companies/${companyId}`,
      [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 }],
    );
  }
}

export function createHubSpotClient(accessToken: string): HubSpotClient {
  if (!accessToken) {
    throw new Error("HubSpot access token is required");
  }
  return new HubSpotClient(accessToken);
}

export type { HubSpotClient };
