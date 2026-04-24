import { schemaTask, logger, queue } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  AgentApiSchemaError,
  buildFirstDmLead,
  buildReplyLead,
  createOutreachClient,
  type FirstDmLead,
  type OutreachBatch,
  type OutreachLead,
  type OutreachReceipt,
  type OutreachResult,
  type ReplyLead,
} from "../../lib/agentapi/index.js";
import {
  createHeyReachClient,
  type HeyReachChatroom,
} from "../../lib/heyreach/index.js";
import {
  createSupabaseClient,
  getCompanyById,
  getResearchSummariesByLeadIds,
  insertLeadMessage,
  logEvents,
  updateLead,
  type Lead,
  type LeadEvent,
  type ResearchSummary,
} from "../../lib/supabase/index.js";

const CHUNK_SIZE = 10;
const CONNECTION_ACCEPTED_EVENT = "connection_request_accepted";

const payloadSchema = z.object({
  companyId: z.string().uuid(),
  batchId: z.string(),
  firstDmLeadIds: z.array(z.string().uuid()),
  replyLeadIds: z.array(z.string().uuid()),
});

export interface ComposeSummary {
  chunks: number;
  ready_to_send: number;
  held_for_human: number;
  send_failures: number;
  dropped_missing_chatroom: number;
  schema_failures: number;
}

// Queue concurrency 1 is required — two concurrent POSTs to :3288 deadlock
// the single-instance outreach-orchestrator agent.
const agentQueue = queue({
  name: "outreach-agent",
  concurrencyLimit: 1,
});

export const composeAndSend = schemaTask({
  id: "compose-and-send",
  queue: agentQueue,
  schema: payloadSchema,
  maxDuration: 1_800,
  retry: { maxAttempts: 1 },
  run: async ({
    companyId,
    batchId,
    firstDmLeadIds,
    replyLeadIds,
  }): Promise<ComposeSummary> => {
    const summary: ComposeSummary = {
      chunks: 0,
      ready_to_send: 0,
      held_for_human: 0,
      send_failures: 0,
      dropped_missing_chatroom: 0,
      schema_failures: 0,
    };

    const company = await getCompanyById(companyId);
    const ourAccountId = company.heyreach_linkedin_account_id;
    if (!ourAccountId) {
      logger.error(
        "compose-and-send: company missing heyreach_linkedin_account_id",
        { companyId },
      );
      return summary;
    }

    const supabase = createSupabaseClient();
    const allLeadIds = [...firstDmLeadIds, ...replyLeadIds];
    if (allLeadIds.length === 0) return summary;

    const { data: leadRows, error: leadErr } = await supabase
      .from("leads")
      .select("*")
      .in("id", allLeadIds);
    if (leadErr) throw new Error(`load leads: ${leadErr.message}`);
    const leadsById = new Map<string, Lead>();
    for (const row of (leadRows ?? []) as Lead[]) {
      leadsById.set(row.id, row);
    }

    const researchByLead = await getResearchSummariesByLeadIds(allLeadIds);

    // connection_accepted_at per lead (oldest event wins).
    const acceptedAtByLead = new Map<string, string>();
    if (firstDmLeadIds.length > 0) {
      const { data: events, error: evErr } = await supabase
        .from("lead_events")
        .select("lead_id, created_at")
        .eq("event_type", CONNECTION_ACCEPTED_EVENT)
        .in("lead_id", firstDmLeadIds)
        .order("created_at", { ascending: true });
      if (evErr) throw new Error(`load events: ${evErr.message}`);
      for (const row of events ?? []) {
        if (!acceptedAtByLead.has(row.lead_id)) {
          acceptedAtByLead.set(row.lead_id, row.created_at);
        }
      }
    }

    const heyreach = createHeyReachClient();
    const firstDmEntries: FirstDmLead[] = [];
    for (const id of firstDmLeadIds) {
      const lead = leadsById.get(id);
      const research = researchByLead.get(id);
      const acceptedAt = acceptedAtByLead.get(id);
      if (!lead || !research || !acceptedAt) continue;
      try {
        firstDmEntries.push(buildFirstDmLead(lead, research, acceptedAt));
      } catch (err) {
        logger.warn("compose-and-send: skipping first_dm lead", {
          lead_id: id,
          error: (err as Error).message,
        });
      }
    }

    const replyEntries: ReplyLead[] = [];
    for (const id of replyLeadIds) {
      const lead = leadsById.get(id);
      const research = researchByLead.get(id);
      if (!lead || !research || !lead.heyreach_conversation_id) {
        summary.dropped_missing_chatroom++;
        continue;
      }
      let chatroom: HeyReachChatroom;
      try {
        chatroom = await heyreach.getChatroom(
          ourAccountId,
          lead.heyreach_conversation_id,
        );
      } catch (err) {
        summary.dropped_missing_chatroom++;
        logger.warn("compose-and-send: getChatroom failed, dropping", {
          lead_id: id,
          error: (err as Error).message,
        });
        continue;
      }
      replyEntries.push(buildReplyLead(lead, research, chatroom, ourAccountId));
    }

    const allEntries: OutreachLead[] = [...firstDmEntries, ...replyEntries];
    if (allEntries.length === 0) return summary;

    const chunks: OutreachLead[][] = [];
    for (let i = 0; i < allEntries.length; i += CHUNK_SIZE) {
      chunks.push(allEntries.slice(i, i + CHUNK_SIZE));
    }
    summary.chunks = chunks.length;

    const client = createOutreachClient();
    const asOf = new Date().toISOString();

    for (let i = 0; i < chunks.length; i++) {
      const chunkLeads = chunks[i]!;
      const chunkBatchId = `${batchId}/chunk-${i}`;
      const batch: OutreachBatch = {
        batch_id: chunkBatchId,
        as_of: asOf,
        leads: chunkLeads,
      };

      let receipt: OutreachReceipt | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          receipt = await client.compose(batch);
          break;
        } catch (err) {
          lastError = err;
          if (err instanceof AgentApiSchemaError && attempt === 0) {
            logger.warn("outreach-orchestrator schema error, retrying once", {
              chunkBatchId,
              kind: err.body.kind,
            });
            continue;
          }
          break;
        }
      }

      if (!receipt) {
        summary.schema_failures++;
        if (lastError instanceof AgentApiSchemaError) {
          await handleBlanketHold(chunkLeads, chunkBatchId, lastError, summary);
        } else {
          logger.error("outreach-orchestrator call failed (will not retry)", {
            chunkBatchId,
            error: (lastError as Error).message,
          });
          throw lastError;
        }
        continue;
      }

      await applyReceipt({
        receipt,
        chunkLeads,
        batchId: chunkBatchId,
        companyId,
        ourAccountId,
        leadsById,
        summary,
      });
    }

    return summary;
  },
});

interface ApplyReceiptArgs {
  receipt: OutreachReceipt;
  chunkLeads: OutreachLead[];
  batchId: string;
  companyId: string;
  ourAccountId: number;
  leadsById: Map<string, Lead>;
  summary: ComposeSummary;
}

async function applyReceipt({
  receipt,
  chunkLeads,
  batchId,
  companyId,
  ourAccountId,
  leadsById,
  summary,
}: ApplyReceiptArgs): Promise<void> {
  const heyreach = createHeyReachClient();
  const events: LeadEvent[] = [];

  const leadsInBatch = new Map(chunkLeads.map((l) => [l.lead_id, l]));

  for (const result of receipt.results) {
    const inputLead = leadsInBatch.get(result.lead_id);
    const dbLead = leadsById.get(result.lead_id);
    if (!inputLead || !dbLead) {
      logger.warn("receipt references unknown lead", {
        batchId,
        lead_id: result.lead_id,
      });
      continue;
    }

    if (result.status === "ready_to_send") {
      try {
        await sendResult(heyreach, dbLead, ourAccountId, result);
      } catch (err) {
        summary.send_failures++;
        logger.error("HeyReach sendMessage failed", {
          batchId,
          lead_id: result.lead_id,
          error: (err as Error).message,
        });
        continue;
      }

      await insertLeadMessage({
        lead_id: result.lead_id,
        channel: "linkedin",
        direction: "outbound",
        content: result.message,
        source_system: "agent",
        external_message_id: null,
        batch_id: batchId,
        input_type: result.input_type,
        copy_source: result.input_type === "first_dm" ? result.copy_source : null,
        intent: result.input_type === "reply" ? result.intent : null,
      });

      events.push({
        lead_id: result.lead_id,
        event_type: "outreach_message_sent",
        source_system: "agent",
        workflow: "WF-5",
        sequence_step: 5,
        detail: {
          batch_id: batchId,
          input_type: result.input_type,
          copy_source:
            result.input_type === "first_dm" ? result.copy_source : null,
          intent: result.input_type === "reply" ? result.intent : null,
          company_id: companyId,
        },
      });

      // Advance funnel_stage only on first_dm: reply sends don't have a
      // clean forward target (the lead is already past `contacted`).
      if (result.input_type === "first_dm") {
        await updateLead(result.lead_id, { funnel_stage: "contacted" });
      }
      summary.ready_to_send++;
    } else {
      await postSlackHold(batchId, dbLead, result);
      events.push({
        lead_id: result.lead_id,
        event_type: "outreach_held_for_human",
        source_system: "agent",
        workflow: "WF-5",
        sequence_step: 5,
        detail: {
          batch_id: batchId,
          intent: result.intent,
          hold_reason: result.hold_reason,
          suggested_draft: result.suggested_draft,
          conversation_summary: result.conversation_summary,
        },
      });
      summary.held_for_human++;
    }
  }

  await logEvents(events);
}

async function sendResult(
  heyreach: ReturnType<typeof createHeyReachClient>,
  lead: Lead,
  ourAccountId: number,
  result: Extract<OutreachResult, { status: "ready_to_send" }>,
): Promise<void> {
  if (!lead.heyreach_conversation_id) {
    throw new Error(`lead ${lead.id} missing heyreach_conversation_id`);
  }
  await heyreach.sendMessage({
    conversationId: lead.heyreach_conversation_id,
    linkedInAccountId: ourAccountId,
    message: result.message,
  });
}

async function handleBlanketHold(
  chunkLeads: OutreachLead[],
  batchId: string,
  error: AgentApiSchemaError,
  summary: ComposeSummary,
): Promise<void> {
  const events: LeadEvent[] = chunkLeads.map((lead) => ({
    lead_id: lead.lead_id,
    event_type: "outreach_held_for_human",
    source_system: "agent",
    workflow: "WF-5",
    sequence_step: 5,
    detail: {
      batch_id: batchId,
      hold_reason: "agent returned unparseable output",
      schema_error_kind: error.body.kind ?? "unknown",
      input_type: lead.input_type,
    },
  }));
  summary.held_for_human += chunkLeads.length;

  const webhookUrl = process.env.SLACK_OUTREACH_HOLD_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `:warning: outreach batch ${batchId} failed schema twice — ${chunkLeads.length} leads held for human review.`,
        }),
      });
    } catch (err) {
      logger.warn("Slack notify failed", { error: (err as Error).message });
    }
  }

  await logEvents(events);
}

async function postSlackHold(
  batchId: string,
  lead: Lead,
  result: Extract<OutreachResult, { status: "held_for_human" }>,
): Promise<void> {
  const webhookUrl = process.env.SLACK_OUTREACH_HOLD_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn(
      "SLACK_OUTREACH_HOLD_WEBHOOK_URL unset; hold decisions go unannounced",
      { lead_id: lead.id, batchId },
    );
    return;
  }
  const title = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  const body = [
    `*Outreach hold* — ${title || lead.email} (${lead.company_name ?? "—"})`,
    `Intent: ${result.intent}`,
    `Reason: ${result.hold_reason}`,
    `Summary: ${result.conversation_summary}`,
    `Suggested draft:\n> ${result.suggested_draft.replaceAll("\n", "\n> ")}`,
    `Lead ID: ${lead.id} · Batch: ${batchId}`,
  ].join("\n");
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body }),
    });
  } catch (err) {
    logger.warn("Slack notify failed", {
      lead_id: lead.id,
      error: (err as Error).message,
    });
  }
}
