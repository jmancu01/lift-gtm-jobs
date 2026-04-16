import { schemaTask, logger, metadata, tags } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  generateRunId,
  getCompanyById,
  getActiveIcp,
  type Company,
  type IcpConfig,
} from "../../lib/supabase/index.js";
import { syncToHubspot } from "../sync-to-hubspot/index.js";
import { discoverLeadsForPersona } from "./discover-leads-for-persona.js";
import type { PersonaResult } from "./types.js";

const DEFAULT_TARGET = 50;
const DEFAULT_PER_PAGE = 25;

const discoverPayloadSchema = z.object({
  companyId: z.string().uuid(),
  target: z.number().int().positive().max(1_000).default(DEFAULT_TARGET),
  perPage: z.number().int().positive().max(100).default(DEFAULT_PER_PAGE),
  dryRun: z.boolean().default(false),
});

export const discoverLeads = schemaTask({
  id: "discover-leads",
  schema: discoverPayloadSchema,
  maxDuration: 3_600,
  run: async ({ companyId, target, perPage, dryRun }) => {
    const runId = generateRunId();
    await tags.add([
      `run_${runId}`,
      `company_${companyId}`,
      dryRun ? "dry_run" : "live",
    ]);

    logger.info("discover-leads starting", {
      runId,
      companyId,
      target,
      perPage,
      dryRun,
    });

    const company: Company = await getCompanyById(companyId);
    if (!company.is_active) {
      throw new Error(`Company ${companyId} is not active`);
    }
    const icp: IcpConfig = await getActiveIcp(companyId);
    if (!icp.personas?.length) {
      throw new Error(`ICP for company ${companyId} has no personas`);
    }

    const personaTarget = Math.ceil(target / icp.personas.length);

    metadata
      .set("company_slug", company.slug)
      .set("icp_version", icp.version)
      .set("personas", icp.personas.length)
      .set("persona_target", personaTarget);

    const batchRun = await discoverLeadsForPersona.batchTriggerAndWait(
      icp.personas.map((persona) => ({
        payload: {
          companyId,
          runId,
          persona,
          icp,
          apolloContactStageId: company.apollo_contact_stage_id,
          personaTarget,
          perPage,
          dryRun,
        },
      })),
    );

    const perPersona: PersonaResult[] = [];
    const newLeadIds: string[] = [];
    let totalInserted = 0;
    let totalErrors = 0;

    for (let i = 0; i < batchRun.runs.length; i++) {
      const run = batchRun.runs[i]!;
      if (run.ok) {
        const out = run.output as PersonaResult;
        perPersona.push(out);
        totalInserted += out.inserted;
        totalErrors += out.errors;
        newLeadIds.push(...out.leadIds);
      } else {
        totalErrors += 1;
        logger.error("persona batch failed", {
          persona_index: i,
          error: run.error,
        });
      }
    }

    let syncTriggered = false;
    let syncRunId: string | undefined;
    if (newLeadIds.length > 0 && !dryRun) {
      const handle = await syncToHubspot.trigger({
        companyId,
        leadIds: newLeadIds,
        dryRun: false,
      });
      syncTriggered = true;
      syncRunId = handle.id;
      logger.info("chained sync-to-hubspot", {
        sync_run_id: syncRunId,
        lead_count: newLeadIds.length,
      });
    }

    logger.info("discover-leads done", {
      runId,
      totalInserted,
      totalErrors,
      syncTriggered,
    });

    return {
      run_id: runId,
      company_id: companyId,
      company_slug: company.slug,
      icp_version: icp.version,
      total_inserted: totalInserted,
      total_errors: totalErrors,
      per_persona: perPersona,
      sync_triggered: syncTriggered,
      sync_run_id: syncRunId ?? null,
      dry_run: dryRun,
    };
  },
});
