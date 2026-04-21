import { task, queue, logger } from "@trigger.dev/sdk";
import {
  createScoutClient,
  buildScoutPrompt,
  researchRowFromScout,
  scoutFitToTier,
  AgentApiSchemaError,
  type ScoutPayload,
} from "../../lib/agentapi/index.js";
import {
  createHubSpotClient,
  contactPropertiesFromScout,
} from "../../lib/hubspot/index.js";
import {
  insertLeadAiResearch,
  updateLead,
  logEvents,
  type Lead,
  type LeadEvent,
} from "../../lib/supabase/index.js";
import { emptySummary } from "./empty-summary.js";
import type { QualifySummary } from "./types.js";

// Scout is an LLM-backed HTTP agent: each /ask typically takes 30-120s and
// costs real money, so we keep per-batch concurrency low and process leads
// sequentially inside a batch. AgentAPI instances behind Caddy can absorb
// some parallelism (scout replicated on 3285/3295/3305), but we cap at 3
// concurrent batches to stay well under the pool size.
const scoutQueue = queue({
  name: "agentapi-scout",
  concurrencyLimit: 3,
});

export const researchLeadsBatch = task({
  id: "research-leads-batch",
  queue: scoutQueue,
  maxDuration: 1_800,
  retry: { maxAttempts: 1 },
  run: async (payload: {
    leads: Lead[];
    runId: string;
    companyId: string;
    companyName: string;
    companyDescription: string | null;
    hubspotAccessToken: string | null;
    dryRun: boolean;
    skipHubspot?: boolean;
  }): Promise<QualifySummary> => {
    const {
      leads,
      runId,
      companyId,
      companyName,
      companyDescription,
      hubspotAccessToken,
      dryRun,
      skipHubspot = false,
    } = payload;
    const summary = emptySummary();
    const events: LeadEvent[] = [];
    const scout = createScoutClient();
    const hubspot =
      !skipHubspot && hubspotAccessToken
        ? createHubSpotClient(hubspotAccessToken)
        : null;

    try {
      for (const lead of leads) {
        let scoutPayload: ScoutPayload | null = null;
        try {
          scoutPayload = await scout.research({
            prompt: buildScoutPrompt(lead, {
              name: companyName,
              description: companyDescription,
            }),
            leadId: lead.id,
          });
        } catch (err) {
          if (err instanceof AgentApiSchemaError) {
            summary.schema_failures++;
            summary.failed++;
            logger.warn("scout schema validation failed — falling back", {
              lead_id: lead.id,
              kind: err.body.kind,
            });
            continue;
          }
          summary.failed++;
          logger.error("scout /ask failed", {
            lead_id: lead.id,
            email: lead.email,
            error: (err as Error).message,
          });
          continue;
        }

        const tier = scoutFitToTier(
          scoutPayload.hubspot_properties.lift_ai_fit_tag,
        );
        summary.by_fit[tier]++;
        const isQualified = tier !== "C";
        if (isQualified) summary.qualified++;
        else summary.not_qualified++;

        try {
          if (!dryRun) {
            await insertLeadAiResearch(
              researchRowFromScout(scoutPayload, {
                leadId: lead.id,
                companyId,
                runId,
              }),
            );
          }

          if (!dryRun && hubspot && lead.hubspot_contact_id) {
            await hubspot.updateContact(
              lead.hubspot_contact_id,
              contactPropertiesFromScout(scoutPayload),
            );
            summary.hubspot_updated++;
          } else if (!lead.hubspot_contact_id) {
            summary.hubspot_missing++;
          }

          if (!dryRun) {
            const now = new Date().toISOString();
            await updateLead(lead.id, {
              icp_tier: tier,
              icp_score: Math.round((scoutPayload.confidence ?? 0) * 100),
              qualification_status: isQualified ? "ready" : "suppressed",
              qualified_at: now,
              funnel_stage: isQualified ? "qualified" : "suppressed",
              suppression_reason: isQualified ? null : "low_icp_fit",
              suppressed_at: isQualified ? null : now,
            });

            events.push({
              lead_id: lead.id,
              event_type: isQualified ? "qualified" : "disqualified",
              source_system: "agentapi-scout",
              workflow: "WF-3",
              sequence_step: 3,
              detail: {
                run_id: runId,
                company_id: companyId,
                fit_tier: tier,
                scout_fit_probability:
                  scoutPayload.hubspot_properties.lift_ai_fit_tag,
                confidence: scoutPayload.confidence,
                research_quality: scoutPayload.research_quality,
                source_count: scoutPayload.sources.length,
                hubspot_contact_id: lead.hubspot_contact_id,
                skipped_hubspot: skipHubspot,
              },
            });
          }

          summary.successful++;
        } catch (err) {
          summary.failed++;
          logger.error("qualify writeback failed", {
            lead_id: lead.id,
            error: (err as Error).message,
          });
        }
      }

      return summary;
    } finally {
      await logEvents(events);
    }
  },
});
