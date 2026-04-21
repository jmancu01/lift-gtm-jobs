import { schemaTask, logger, metadata, tags } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  createSupabaseClient,
  generateRunId,
  getCompanyById,
  type Lead,
} from "../../lib/supabase/index.js";
import { researchLeadsBatch } from "./research-leads-batch.js";
import { emptySummary } from "./empty-summary.js";
import type { QualifySummary } from "./types.js";

const RESEARCH_BATCH_SIZE = 5;
const DEFAULT_LIMIT = 50;

const payloadSchema = z.object({
  companyId: z.string().uuid(),
  limit: z.number().int().positive().max(500).default(DEFAULT_LIMIT),
  leadIds: z.array(z.string().uuid()).optional(),
  dryRun: z.boolean().default(false),
  // When true, skip the HubSpot writeback but still persist scout output to
  // Supabase (lead_ai_research + leads verdict). Useful for staging tests
  // where we don't want to mutate the CRM.
  skipHubspot: z.boolean().default(false),
});

/**
 * Orchestrates ICP qualification via the scout AgentAPI microservice:
 *   1. Selects leads already synced to HubSpot that haven't been qualified yet.
 *   2. Splits them into small batches (scout is LLM-paced).
 *   3. Each batch calls POST /ask against scout with schema=scout.v1 per lead.
 *   4. Writes lift_ai_* properties + icp_tier/qualification_status back to
 *      HubSpot and Supabase; leads are promoted to funnel_stage=qualified or
 *      demoted to disqualified so downstream outreach skips poor-fit people.
 */
export const researchAndQualify = schemaTask({
  id: "research-and-qualify",
  schema: payloadSchema,
  maxDuration: 3_600,
  run: async ({ companyId, limit, leadIds, dryRun, skipHubspot }) => {
    const runId = generateRunId();
    await tags.add([
      `run_${runId}`,
      `company_${companyId}`,
      dryRun ? "dry_run" : "live",
    ]);

    logger.info("research-and-qualify starting", {
      runId,
      companyId,
      limit,
      dryRun,
      skipHubspot,
      explicit_lead_ids: leadIds?.length ?? 0,
    });

    const company = await getCompanyById(companyId);

    const supabase = createSupabaseClient();
    let query = supabase
      .from("leads")
      .select("*")
      .eq("company_id", companyId);

    if (leadIds && leadIds.length > 0) {
      query = query.in("id", leadIds);
    } else {
      // Default selection: leads that were synced to HubSpot but haven't been
      // qualified yet. The filter is idempotent — re-running skips anything
      // that already has a qualification_status.
      query = query
        .eq("funnel_stage", "synced")
        .is("qualification_status", null);
    }

    const { data, error } = await query
      .order("synced_at", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) throw new Error(`Failed to query leads: ${error.message}`);
    const leads = (data ?? []) as Lead[];

    if (leads.length === 0) {
      logger.info("no leads to research");
      return {
        run_id: runId,
        company_id: companyId,
        total: 0,
        batches: 0,
        summary: emptySummary(),
      };
    }

    const batches: Lead[][] = [];
    for (let i = 0; i < leads.length; i += RESEARCH_BATCH_SIZE) {
      batches.push(leads.slice(i, i + RESEARCH_BATCH_SIZE));
    }

    metadata
      .set("company_slug", company.slug)
      .set("total_leads", leads.length)
      .set("total_batches", batches.length);

    logger.info("dispatching research batches", {
      total: leads.length,
      batches: batches.length,
      batch_size: RESEARCH_BATCH_SIZE,
    });

    const batchRun = await researchLeadsBatch.batchTriggerAndWait(
      batches.map((batch) => ({
        payload: {
          leads: batch,
          runId,
          companyId,
          companyName: company.name,
          companyDescription: company.description,
          hubspotAccessToken: company.hubspot_access_token,
          dryRun,
          skipHubspot,
        },
      })),
    );

    const totals = emptySummary();
    for (let i = 0; i < batchRun.runs.length; i++) {
      const run = batchRun.runs[i]!;
      if (run.ok) {
        const out = run.output as QualifySummary;
        totals.successful += out.successful;
        totals.failed += out.failed;
        totals.qualified += out.qualified;
        totals.not_qualified += out.not_qualified;
        totals.schema_failures += out.schema_failures;
        totals.hubspot_updated += out.hubspot_updated;
        totals.hubspot_missing += out.hubspot_missing;
        for (const [fit, count] of Object.entries(out.by_fit)) {
          totals.by_fit[fit as keyof QualifySummary["by_fit"]] += count;
        }
      } else {
        totals.failed += batches[i]!.length;
        logger.error("research batch failed", {
          batch_index: i,
          error: run.error,
        });
      }
    }

    logger.info("research-and-qualify done", { runId, totals });
    return {
      run_id: runId,
      company_id: companyId,
      total: leads.length,
      batches: batches.length,
      summary: totals,
    };
  },
});
