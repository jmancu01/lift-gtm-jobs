import { requireEnv } from "../env.js";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

export interface InstantlyLeadData {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  personalization?: string;
}

export interface InstantlyLeadResponse {
  id?: string;
  email: string;
  status?: string;
  [key: string]: unknown;
}

class InstantlyClient {
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async createLead(
    campaignId: string,
    data: InstantlyLeadData,
  ): Promise<InstantlyLeadResponse> {
    const response = await fetch(`${INSTANTLY_API_BASE}/leads`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        campaign: campaignId,
        skip_if_in_campaign: true,
        email: data.email,
        first_name: data.first_name || "",
        last_name: data.last_name || "",
        company_name: data.company_name || "",
        personalization: data.personalization || "",
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Instantly API error (${response.status}): ${await response.text()}`,
      );
    }
    return (await response.json()) as InstantlyLeadResponse;
  }

  async getLead(leadId: string): Promise<InstantlyLeadResponse | null> {
    const response = await fetch(
      `${INSTANTLY_API_BASE}/leads/${encodeURIComponent(leadId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${this.apiKey}` } },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Instantly getLead error (${response.status}): ${await response.text()}`,
      );
    }
    return (await response.json()) as InstantlyLeadResponse;
  }

  async findLeadsByEmail(
    email: string,
    limit = 10,
  ): Promise<InstantlyLeadResponse[]> {
    const response = await fetch(`${INSTANTLY_API_BASE}/leads/list`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ contacts: [email], limit }),
    });
    if (!response.ok) {
      throw new Error(
        `Instantly findLeadsByEmail error (${response.status}): ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { items?: InstantlyLeadResponse[] };
    return body.items || [];
  }

  async deleteLead(leadId: string): Promise<void> {
    const response = await fetch(
      `${INSTANTLY_API_BASE}/leads/${encodeURIComponent(leadId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${this.apiKey}` } },
    );
    if (!response.ok && response.status !== 204 && response.status !== 404) {
      const errorText = await response.text();
      console.error(
        `Instantly deleteLead ${leadId} failed: status=${response.status} body=${errorText}`,
      );
      throw new Error(
        `Instantly delete lead error (${response.status}): ${errorText}`,
      );
    }
  }

  async addToBlocklist(value: string): Promise<void> {
    const response = await fetch(
      `${INSTANTLY_API_BASE}/block-lists-entries`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ bl_value: value }),
      },
    );
    if (!response.ok && response.status !== 409) {
      throw new Error(
        `Instantly addToBlocklist error (${response.status}): ${await response.text()}`,
      );
    }
  }
}

export function createInstantlyClient(): InstantlyClient {
  return new InstantlyClient(requireEnv("INSTANTLY_API_KEY"));
}

export type { InstantlyClient };
