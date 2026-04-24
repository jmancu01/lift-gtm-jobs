import { z } from "zod";
import { requireEnv } from "../env.js";
import {
  AgentApiSchemaError,
  type AskErrorBody,
  type AskResponse,
  type OutreachBatch,
  type OutreachReceipt,
} from "./types.js";

const OUTREACH_SCHEMA = "outreach.v1";
// PLAN §8: batch of 10 targets <45s. Give ourselves 4x headroom so a slow
// batch still fails before the Trigger.dev task ceiling.
const DEFAULT_TIMEOUT_MS = 180_000;

export interface OutreachClient {
  compose(batch: OutreachBatch): Promise<OutreachReceipt>;
}

const firstDmResultSchema = z.object({
  lead_id: z.string().uuid(),
  input_type: z.literal("first_dm"),
  status: z.literal("ready_to_send"),
  copy_source: z.enum(["scout_passthrough", "override"]),
  message: z.string().min(1),
  reasoning: z.string(),
});

const replyIntentSchema = z.enum([
  "engaged_positive",
  "asking_for_info",
  "objection_or_cold",
  "out_of_scope",
  "negative_or_unsubscribe",
]);

const replyReadyResultSchema = z.object({
  lead_id: z.string().uuid(),
  input_type: z.literal("reply"),
  status: z.literal("ready_to_send"),
  intent: replyIntentSchema,
  conversation_summary: z.string(),
  message: z.string().min(1),
  reasoning: z.string(),
});

const replyHeldResultSchema = z.object({
  lead_id: z.string().uuid(),
  input_type: z.literal("reply"),
  status: z.literal("held_for_human"),
  intent: replyIntentSchema,
  conversation_summary: z.string(),
  hold_reason: z.string(),
  suggested_draft: z.string(),
});

const outreachResultSchema = z.discriminatedUnion("status", [
  firstDmResultSchema,
  replyReadyResultSchema,
  replyHeldResultSchema,
]);

const outreachReceiptSchema = z.object({
  batch_id: z.string(),
  results: z.array(outreachResultSchema),
});

class AgentApiOutreachClient implements OutreachClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
  ) {}

  async compose(batch: OutreachBatch): Promise<OutreachReceipt> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Batch-Id": batch.batch_id,
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    // PLAN §11: every prompt starts with `batch_id:<id>` so
    // heartbeat_runs can be joined back to Trigger.dev runs.
    const prompt = `batch_id:${batch.batch_id}\n${JSON.stringify(batch)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${this.baseUrl}/outreach-orchestrator/message`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt,
            schema: OUTREACH_SCHEMA,
            batch_id: batch.batch_id,
          }),
          signal: controller.signal,
        },
      );

      if (response.status === 400) {
        const body = (await response.json().catch(() => ({}))) as AskErrorBody;
        throw new AgentApiSchemaError(
          `outreach schema validation failed: ${body.kind ?? "unknown"}`,
          body,
          400,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(
          `AgentAPI /outreach-orchestrator/message failed (${response.status}): ${text}`,
        );
      }

      const data = (await response.json()) as AskResponse<unknown>;
      if (!data.parsed) {
        throw new Error(
          `AgentAPI outreach returned no parsed payload (schema=${data.schema ?? "n/a"})`,
        );
      }

      const receipt = outreachReceiptSchema.safeParse(data.parsed);
      if (!receipt.success) {
        throw new AgentApiSchemaError(
          `outreach receipt failed local Zod validation: ${receipt.error.message}`,
          { kind: "schema_mismatch", schema: OUTREACH_SCHEMA },
          400,
        );
      }
      return receipt.data;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createOutreachClient(): OutreachClient {
  const baseUrl = requireEnv("AGENTAPI_BASE_URL").replace(/\/$/, "");
  const authToken = process.env.AGENTAPI_AUTH_TOKEN ?? "";
  return new AgentApiOutreachClient(baseUrl, authToken);
}
