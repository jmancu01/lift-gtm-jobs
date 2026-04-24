import { requireEnv } from "../env.js";
import type {
  ApolloBulkEnrichRequest,
  ApolloBulkEnrichResponse,
  ApolloContactResponse,
  ApolloContactsSearchResponse,
  ApolloCreateContactInput,
  ApolloSearchFilters,
  ApolloSearchResponse,
} from "./types.js";

const APOLLO_API_BASE = "https://api.apollo.io";

class ApolloClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string>,
    retries = 3,
  ): Promise<T> {
    let url = `${APOLLO_API_BASE}${path}`;
    if (queryParams) {
      url += `?${new URLSearchParams(queryParams).toString()}`;
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": this.apiKey,
    };
    const options: RequestInit = { method, headers };
    if (body) options.body = JSON.stringify(body);

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(
          `Apollo 429 (attempt ${attempt + 1}/${retries + 1}), waiting ${waitMs}ms`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Apollo API error ${response.status}: ${text || response.statusText}`,
        );
      }
      return (await response.json()) as T;
    }
    throw new Error(`Apollo rate limit exceeded after ${retries + 1} attempts`);
  }

  async searchPeople(
    filters: ApolloSearchFilters,
  ): Promise<ApolloSearchResponse> {
    return this.request<ApolloSearchResponse>(
      "POST",
      "/api/v1/mixed_people/api_search",
      filters,
    );
  }

  async bulkEnrichPeople(
    details: ApolloBulkEnrichRequest["details"],
    revealPersonalEmails = false,
    options?: {
      waterfallEmail?: { webhookUrl: string };
      revealPhone?: { webhookUrl: string; waterfall?: boolean };
    },
  ): Promise<ApolloBulkEnrichResponse> {
    const body: Record<string, unknown> = {
      details,
      reveal_personal_emails: revealPersonalEmails,
    };
    // Apollo accepts a single webhook_url per call; waterfall email and phone
    // reveal both post their async results to the same endpoint.
    const webhookUrl =
      options?.waterfallEmail?.webhookUrl ?? options?.revealPhone?.webhookUrl;
    if (options?.waterfallEmail?.webhookUrl) {
      body.run_waterfall_email = true;
    }
    if (options?.revealPhone?.webhookUrl) {
      body.reveal_phone_number = true;
      if (options.revealPhone.waterfall) body.run_waterfall_phone = true;
    }
    if (webhookUrl) body.webhook_url = webhookUrl;
    return this.request<ApolloBulkEnrichResponse>(
      "POST",
      "/api/v1/people/bulk_match",
      body,
    );
  }

  async searchContacts(
    params: { qKeywords?: string; perPage?: number; page?: number },
  ): Promise<ApolloContactsSearchResponse> {
    const body: Record<string, unknown> = {};
    if (params.qKeywords) body.q_keywords = params.qKeywords;
    if (params.perPage) body.per_page = params.perPage;
    if (params.page) body.page = params.page;
    return this.request<ApolloContactsSearchResponse>(
      "POST",
      "/api/v1/contacts/search",
      body,
    );
  }

  async createContact(
    input: ApolloCreateContactInput,
  ): Promise<ApolloContactResponse> {
    return this.request<ApolloContactResponse>(
      "POST",
      "/api/v1/contacts",
      input,
    );
  }
}

export function createApolloClient(): ApolloClient {
  return new ApolloClient(requireEnv("APOLLO_API_KEY"));
}

export type { ApolloClient };
