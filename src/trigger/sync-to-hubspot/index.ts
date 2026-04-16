import { schemaTask, logger, metadata, tags } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  createSupabaseClient,
  generateRunId,
  getCompanyById,
  type Lead,
} from "../../lib/supabase/index.js";
import { syncLeadsToHubspotBatch } from "./sync-leads-to-hubspot-batch.js";
import { emptySummary } from "./empty-summary.js";
import type { SyncSummary } from "./types.js";

const SYNC_BATCH_SIZE = 10;
const DEFAULT_LIMIT = 100;

const syncPayloadSchema = z.object({
  companyId: z.string().uuid(),
  limit: z.number().int().positive().max(2_000).default(DEFAULT_LIMIT),
  leadIds: z.array(z.string().uuid()).optional(),
  dryRun: z.boolean().default(false),
});

export const syncToHubspot = schemaTask({
  id: "sync-to-hubspot",
  schema: syncPayloadSchema,
  maxDuration: 1_800,
  run: async ({ companyId, limit, leadIds, dryRun }) => {
    const runId = generateRunId();
    await tags.add([
      `run_${runId}`,
      `company_${companyId}`,
      dryRun ? "dry_run" : "live",
    ]);

    logger.info("sync-to-hubspot starting", {
      runId,
      companyId,
      limit,
      dryRun,
      explicit_lead_ids: leadIds?.length ?? 0,
    });

    const company = await getCompanyById(companyId);
    if (!company.hubspot_access_token) {
      throw new Error(
        `Company ${companyId} has no hubspot_access_token configured`,
      );
    }

    const supabase = createSupabaseClient();
    let query = supabase
      .from("leads")
      .select("*")
      .eq("company_id", companyId);

    if (leadIds && leadIds.length > 0) {
      query = query.in("id", leadIds);
    } else {
      query = query.eq("funnel_stage", "discovered");
    }

    const { data, error } = await query
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`Failed to query leads: ${error.message}`);
    const leads = (data ?? []) as Lead[];

    if (leads.length === 0) {
      logger.info("no leads to sync");
      return {
        run_id: runId,
        company_id: companyId,
        total: 0,
        batches: 0,
        summary: emptySummary(),
      };
    }

    const batches: Lead[][] = [];
    for (let i = 0; i < leads.length; i += SYNC_BATCH_SIZE) {
      batches.push(leads.slice(i, i + SYNC_BATCH_SIZE));
    }

    metadata
      .set("company_slug", company.slug)
      .set("total_leads", leads.length)
      .set("total_batches", batches.length);

    logger.info("dispatching batches", {
      total: leads.length,
      batches: batches.length,
    });

    const batchRun = await syncLeadsToHubspotBatch.batchTriggerAndWait(
      batches.map((batch) => ({
        payload: {
          leads: batch,
          runId,
          companyId,
          hubspotAccessToken: company.hubspot_access_token!,
          dryRun,
        },
      })),
    );

    const totals = emptySummary();
    for (let i = 0; i < batchRun.runs.length; i++) {
      const run = batchRun.runs[i]!;
      if (run.ok) {
        for (const [k, v] of Object.entries(run.output) as [
          keyof SyncSummary,
          number,
        ][]) {
          totals[k] += v;
        }
      } else {
        totals.failed += batches[i]!.length;
        logger.error("batch failed", { batch_index: i, error: run.error });
      }
    }

    logger.info("sync-to-hubspot done", { runId, totals });
    return {
      run_id: runId,
      company_id: companyId,
      total: leads.length,
      batches: batches.length,
      summary: totals,
    };
  },
});
