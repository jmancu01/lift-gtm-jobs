import { schemaTask, logger, metadata, tags } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  createSupabaseClient,
  generateRunId,
  type Lead,
} from "../../lib/supabase/index.js";
import { processEnrollmentBatch } from "./process-enrollment-batch.js";
import { emptySummary } from "./empty-summary.js";
import type { BatchSummary } from "./types.js";

const ENRICH_BATCH_SIZE = 10;
const DEFAULT_LIMIT = 500;

const verifyPayloadSchema = z.object({
  limit: z.number().int().positive().max(5_000).default(DEFAULT_LIMIT),
  mode: z.enum(["verify", "backfill_risky"]).default("verify"),
  dryRun: z.boolean().default(false),
});

export const verifyEnrolledLeads = schemaTask({
  id: "verify-enrolled-leads",
  schema: verifyPayloadSchema,
  maxDuration: 900,
  run: async ({ limit, mode, dryRun }) => {
    const runId = generateRunId();
    await tags.add([`run_${runId}`, `mode_${mode}`]);

    logger.info("verify-enrolled-leads starting", { runId, limit, mode, dryRun });

    const supabase = createSupabaseClient();
    let query = supabase.from("leads").select("*").eq("funnel_stage", "enrolled");

    if (mode === "backfill_risky") {
      query = query.eq("email_status", "risky").not("instantly_id", "is", null);
    } else {
      query = query.is("email_status", null).not("apollo_id", "is", null);
    }

    const { data, error } = await query
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`Failed to query leads: ${error.message}`);
    const leads = (data ?? []) as Lead[];

    if (leads.length === 0) {
      logger.info("no leads to verify");
      return { run_id: runId, total: 0, batches: 0, summary: emptySummary() };
    }

    const batches: Lead[][] = [];
    for (let i = 0; i < leads.length; i += ENRICH_BATCH_SIZE) {
      batches.push(leads.slice(i, i + ENRICH_BATCH_SIZE));
    }

    metadata
      .set("total_leads", leads.length)
      .set("total_batches", batches.length);

    logger.info("dispatching batches", {
      total: leads.length,
      batches: batches.length,
    });

    const batchRun = await processEnrollmentBatch.batchTriggerAndWait(
      batches.map((batch) => ({
        payload: { leads: batch, runId, mode, dryRun },
      })),
    );

    const totals = emptySummary();
    for (let i = 0; i < batchRun.runs.length; i++) {
      const run = batchRun.runs[i]!;
      if (run.ok) {
        for (const [k, v] of Object.entries(run.output) as [
          keyof BatchSummary,
          number,
        ][]) {
          totals[k] += v;
        }
      } else {
        totals.errors += batches[i]!.length;
        logger.error("batch failed", { batch_index: i, error: run.error });
      }
    }

    logger.info("verify-enrolled-leads done", { runId, totals });
    return {
      run_id: runId,
      total: leads.length,
      batches: batches.length,
      summary: totals,
    };
  },
});
