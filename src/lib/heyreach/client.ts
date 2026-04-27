import { requireEnv } from "../env.js";
import type {
  HeyReachAddLeadsResult,
  HeyReachAddLeadsToCampaignParams,
  HeyReachAddLeadsToListParams,
  HeyReachCampaign,
  HeyReachCampaignLead,
  HeyReachChatroom,
  HeyReachCompany,
  HeyReachCreateEmptyListParams,
  HeyReachCreateWebhookParams,
  HeyReachDeleteLeadsFromListByProfileUrlParams,
  HeyReachDeleteLeadsFromListParams,
  HeyReachGetAllCampaignsParams,
  HeyReachGetAllLinkedInAccountsParams,
  HeyReachGetAllListsParams,
  HeyReachGetCampaignsForLeadParams,
  HeyReachGetCompaniesFromListParams,
  HeyReachGetConversationsParams,
  HeyReachGetLeadsFromCampaignParams,
  HeyReachGetLeadsFromListParams,
  HeyReachGetListsForLeadParams,
  HeyReachGetOverallStatsParams,
  HeyReachIsConnectionParams,
  HeyReachLead,
  HeyReachLeadTagsParams,
  HeyReachLinkedInAccount,
  HeyReachList,
  HeyReachMyNetworkParams,
  HeyReachOverallStatsResponse,
  HeyReachPaginatedResponse,
  HeyReachSendMessageParams,
  HeyReachSetSeenStatusParams,
  HeyReachStopLeadInCampaignParams,
  HeyReachTag,
  HeyReachTagInput,
  HeyReachUpdateWebhookParams,
  HeyReachWebhook,
} from "./types.js";

const HEYREACH_API_BASE = "https://api.heyreach.io";

class HeyReachClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | undefined>,
    retries = 3,
  ): Promise<T> {
    let url = `${HEYREACH_API_BASE}${path}`;
    if (queryParams) {
      const entries = Object.entries(queryParams).filter(
        ([, v]) => v !== undefined,
      );
      if (entries.length) {
        const params = new URLSearchParams();
        for (const [k, v] of entries) params.set(k, String(v));
        url += `?${params.toString()}`;
      }
    }
    const headers: Record<string, string> = {
      "X-API-KEY": this.apiKey,
      Accept: "application/json",
    };
    const options: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(
          `HeyReach 429 (attempt ${attempt + 1}/${retries + 1}), waiting ${waitMs}ms`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `HeyReach API error ${response.status}: ${text || response.statusText}`,
        );
      }
      const text = await response.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    }
    throw new Error(
      `HeyReach rate limit exceeded after ${retries + 1} attempts`,
    );
  }

  async checkApiKey(): Promise<boolean> {
    await this.request<void>("GET", "/api/public/auth/CheckApiKey");
    return true;
  }

  async getAllCampaigns(
    params: HeyReachGetAllCampaignsParams = {},
  ): Promise<HeyReachPaginatedResponse<HeyReachCampaign>> {
    return this.request("POST", "/api/public/campaign/GetAll", {
      offset: params.offset ?? 0,
      limit: params.limit ?? 100,
      ...(params.keyword !== undefined && { keyword: params.keyword }),
      ...(params.statuses && { statuses: params.statuses }),
      ...(params.accountIds && { accountIds: params.accountIds }),
    });
  }

  async getCampaign(campaignId: number): Promise<HeyReachCampaign> {
    return this.request(
      "GET",
      "/api/public/campaign/GetById",
      undefined,
      { campaignId },
    );
  }

  async resumeCampaign(campaignId: number): Promise<void> {
    await this.request("POST", "/api/public/campaign/Resume", undefined, {
      campaignId,
    });
  }

  async pauseCampaign(campaignId: number): Promise<void> {
    await this.request("POST", "/api/public/campaign/Pause", undefined, {
      campaignId,
    });
  }

  async addLeadsToCampaign(
    params: HeyReachAddLeadsToCampaignParams,
  ): Promise<HeyReachAddLeadsResult> {
    return this.request(
      "POST",
      "/api/public/campaign/AddLeadsToCampaignV2",
      params,
    );
  }

  async stopLeadInCampaign(
    params: HeyReachStopLeadInCampaignParams,
  ): Promise<void> {
    await this.request(
      "POST",
      "/api/public/campaign/StopLeadInCampaign",
      params,
    );
  }

  async getLeadsFromCampaign(
    params: HeyReachGetLeadsFromCampaignParams,
  ): Promise<HeyReachPaginatedResponse<HeyReachCampaignLead>> {
    return this.request(
      "POST",
      "/api/public/campaign/GetLeadsFromCampaign",
      {
        offset: 0,
        limit: 100,
        ...params,
      },
    );
  }

  async getCampaignsForLead(
    params: HeyReachGetCampaignsForLeadParams,
  ): Promise<HeyReachPaginatedResponse<HeyReachCampaign>> {
    return this.request(
      "POST",
      "/api/public/campaign/GetCampaignsForLead",
      { offset: 0, limit: 100, ...params },
    );
  }

  async getAllLinkedInAccounts(
    params: HeyReachGetAllLinkedInAccountsParams = {},
  ): Promise<HeyReachPaginatedResponse<HeyReachLinkedInAccount>> {
    return this.request("POST", "/api/public/li_account/GetAll", {
      offset: params.offset ?? 0,
      limit: params.limit ?? 100,
      ...(params.keyword !== undefined && { keyword: params.keyword }),
    });
  }

  async getLinkedInAccount(accountId: number): Promise<HeyReachLinkedInAccount> {
    return this.request(
      "GET",
      "/api/public/li_account/GetById",
      undefined,
      { accountId },
    );
  }

  async getAllLists(
    params: HeyReachGetAllListsParams = {},
  ): Promise<HeyReachPaginatedResponse<HeyReachList>> {
    return this.request("POST", "/api/public/list/GetAll", {
      offset: params.offset ?? 0,
      limit: params.limit ?? 100,
      ...(params.keyword !== undefined && { keyword: params.keyword }),
      ...(params.listType && { listType: params.listType }),
      ...(params.campaignIds && { campaignIds: params.campaignIds }),
    });
  }

  async getList(listId: number): Promise<HeyReachList> {
    return this.request("GET", "/api/public/list/GetById", undefined, {
      listId,
    });
  }

  async getLeadsFromList(
    params: HeyReachGetLeadsFromListParams,
  ): Promise<HeyReachPaginatedResponse<HeyReachLead>> {
    return this.request("POST", "/api/public/list/GetLeadsFromList", {
      offset: 0,
      limit: 100,
      ...params,
    });
  }

  async getCompaniesFromList(
    params: HeyReachGetCompaniesFromListParams,
  ): Promise<HeyReachPaginatedResponse<HeyReachCompany>> {
    return this.request("POST", "/api/public/list/GetCompaniesFromList", {
      offset: 0,
      limit: 100,
      ...params,
    });
  }

  async addLeadsToList(
    params: HeyReachAddLeadsToListParams,
  ): Promise<HeyReachAddLeadsResult> {
    return this.request("POST", "/api/public/list/AddLeadsToListV2", params);
  }

  async deleteLeadsFromList(
    params: HeyReachDeleteLeadsFromListParams,
  ): Promise<void> {
    await this.request(
      "DELETE",
      "/api/public/list/DeleteLeadsFromList",
      params,
    );
  }

  async deleteLeadsFromListByProfileUrl(
    params: HeyReachDeleteLeadsFromListByProfileUrlParams,
  ): Promise<void> {
    await this.request(
      "DELETE",
      "/api/public/list/DeleteLeadsFromListByProfileUrl",
      params,
    );
  }

  async getListsForLead(
    params: HeyReachGetListsForLeadParams,
  ): Promise<HeyReachPaginatedResponse<HeyReachList>> {
    return this.request("POST", "/api/public/list/GetListsForLead", {
      offset: 0,
      limit: 100,
      ...params,
    });
  }

  async createEmptyList(
    params: HeyReachCreateEmptyListParams,
  ): Promise<HeyReachList> {
    return this.request("POST", "/api/public/list/CreateEmptyList", params);
  }

  async getConversations(
    params: HeyReachGetConversationsParams = {},
  ): Promise<HeyReachPaginatedResponse<HeyReachChatroom>> {
    return this.request("POST", "/api/public/inbox/GetConversationsV2", {
      offset: params.offset ?? 0,
      limit: params.limit ?? 50,
      filters: params.filters ?? {},
    });
  }

  async getChatroom(
    accountId: number,
    conversationId: string,
  ): Promise<HeyReachChatroom> {
    return this.request(
      "GET",
      `/api/public/inbox/GetChatroom/${encodeURIComponent(
        String(accountId),
      )}/${encodeURIComponent(conversationId)}`,
    );
  }

  async sendMessage(params: HeyReachSendMessageParams): Promise<void> {
    await this.request("POST", "/api/public/inbox/SendMessage", params);
  }

  async setSeenStatus(params: HeyReachSetSeenStatusParams): Promise<void> {
    await this.request("POST", "/api/public/inbox/SetSeenStatus", params);
  }

  async getOverallStats(
    params: HeyReachGetOverallStatsParams,
  ): Promise<HeyReachOverallStatsResponse> {
    return this.request("POST", "/api/public/stats/GetOverallStats", params);
  }

  async getLead(profileUrl: string): Promise<HeyReachLead> {
    return this.request("POST", "/api/public/lead/GetLead", { profileUrl });
  }

  async addLeadTags(params: HeyReachLeadTagsParams): Promise<void> {
    await this.request("POST", "/api/public/lead/AddTags", {
      createTagIfNotExisting: false,
      ...params,
    });
  }

  async getLeadTags(profileUrl: string): Promise<string[]> {
    return this.request<string[]>("POST", "/api/public/lead/GetTags", {
      profileUrl,
    });
  }

  async replaceLeadTags(params: HeyReachLeadTagsParams): Promise<void> {
    await this.request("POST", "/api/public/lead/ReplaceTags", {
      createTagIfNotExisting: false,
      ...params,
    });
  }

  async createTags(tags: HeyReachTagInput[]): Promise<HeyReachTag[]> {
    return this.request("POST", "/api/public/lead_tags/CreateTags", { tags });
  }

  async createWebhook(
    params: HeyReachCreateWebhookParams,
  ): Promise<HeyReachWebhook> {
    return this.request("POST", "/api/public/webhooks/CreateWebhook", params);
  }

  async getWebhook(webhookId: number): Promise<HeyReachWebhook> {
    return this.request(
      "GET",
      "/api/public/webhooks/GetWebhookById",
      undefined,
      { webhookId },
    );
  }

  async getAllWebhooks(
    params: { offset?: number; limit?: number } = {},
  ): Promise<HeyReachPaginatedResponse<HeyReachWebhook>> {
    return this.request("POST", "/api/public/webhooks/GetAllWebhooks", {
      offset: params.offset ?? 0,
      limit: params.limit ?? 100,
    });
  }

  async updateWebhook(
    webhookId: number,
    params: HeyReachUpdateWebhookParams,
  ): Promise<HeyReachWebhook> {
    return this.request(
      "PATCH",
      "/api/public/webhooks/UpdateWebhook",
      params,
      { webhookId },
    );
  }

  async deleteWebhook(webhookId: number): Promise<void> {
    await this.request(
      "DELETE",
      "/api/public/webhooks/DeleteWebhook",
      undefined,
      { webhookId },
    );
  }

  async getMyNetworkForSender(
    params: HeyReachMyNetworkParams,
  ): Promise<HeyReachPaginatedResponse<HeyReachLead>> {
    return this.request("POST", "/api/public/MyNetwork/GetMyNetworkForSender", {
      pageNumber: 0,
      pageSize: 100,
      ...params,
    });
  }

  async isConnection(
    params: HeyReachIsConnectionParams,
  ): Promise<{ isConnection: boolean } & Record<string, unknown>> {
    return this.request("POST", "/api/public/MyNetwork/IsConnection", params);
  }
}

export function createHeyReachClient(): HeyReachClient {
  return new HeyReachClient(requireEnv("HEYREACH_API_KEY"));
}

export { HeyReachClient };
