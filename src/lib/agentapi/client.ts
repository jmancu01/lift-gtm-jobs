import { requireEnv } from "../env.js";
import {
  AgentApiSchemaError,
  type AskErrorBody,
  type AskResponse,
  type ScoutPayload,
} from "./types.js";

const SCOUT_SCHEMA = "scout.v1";
// Scout with web research can take 5-8 min per lead. Batch task maxDuration
// is 1800s (30 min) → 10 min is a safe upper bound that still surfaces a
// wedged agent before the whole batch dies.
const DEFAULT_TIMEOUT_MS = 600_000;

export interface ScoutAskOptions {
  prompt: string;
  leadId: string;
  timeoutMs?: number;
}

export interface ScoutClient {
  research(options: ScoutAskOptions): Promise<ScoutPayload>;
}

class AgentApiScoutClient implements ScoutClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
  ) {}

  async research({
    prompt,
    leadId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: ScoutAskOptions): Promise<ScoutPayload> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Lead-Id": leadId,
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt,
          schema: SCOUT_SCHEMA,
          lead_id: leadId,
        }),
        signal: controller.signal,
      });

      if (response.status === 400) {
        const body = (await response.json().catch(() => ({}))) as AskErrorBody;
        throw new AgentApiSchemaError(
          `scout schema validation failed: ${body.kind ?? "unknown"}`,
          body,
          400,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`AgentAPI /ask failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as AskResponse<ScoutPayload>;
      if (!data.parsed) {
        throw new Error(
          `AgentAPI /ask returned no parsed payload (schema=${data.schema ?? "n/a"})`,
        );
      }
      return data.parsed;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createScoutClient(): ScoutClient {
  const baseUrl = requireEnv("AGENTAPI_SCOUT_URL").replace(/\/$/, "");
  const authToken = process.env.AGENTAPI_AUTH_TOKEN ?? "";
  return new AgentApiScoutClient(baseUrl, authToken);
}
