import { task, queue, logger } from "@trigger.dev/sdk";
import {
  updateLead,
  logEvents,
  type Lead,
  type LeadEvent,
} from "../../lib/supabase/index.js";
import { createApolloClient } from "../../lib/apollo/index.js";
import { createInstantlyClient } from "../../lib/instantly/index.js";
import { evaluateEmail } from "../../lib/helpers/index.js";
import { emptySummary } from "./empty-summary.js";
import { makeHubSpotResolver } from "./hubspot-resolver.js";
import type { BatchSummary } from "./types.js";

// Apollo bulk_match is rate-limited; cap parallel batches so fan-out
// can't flood it regardless of how many batches the parent dispatches.
const apolloQueue = queue({
  name: "apollo-enrich",
  concurrencyLimit: 3,
});

/**
 * Processes one Apollo batch. Retries are disabled — failed batches leave
 * their leads in the source state (email_status null), so the next parent
 * run naturally redrives them via its query filter. This keeps the child
 * idempotent without needing per-event dedup in the database.
 */
export const processEnrollmentBatch = task({
  id: "process-enrollment-batch",
  queue: apolloQueue,
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  run: async (payload: {
    leads: Lead[];
    runId: string;
    mode: "verify" | "backfill_risky";
    dryRun: boolean;
  }): Promise<BatchSummary> => {
    const { leads, runId, mode, dryRun } = payload;
    const summary = emptySummary();
    const events: LeadEvent[] = [];

    if (dryRun) {
      summary.valid = leads.length;
      return summary;
    }

    try {
      if (mode === "backfill_risky") {
        const instantly = createInstantlyClient();
        for (const lead of leads) {
          try {
            const changes: Partial<Lead> = {};
            if (lead.instantly_id) {
              await instantly.deleteLead(lead.instantly_id);
              (changes as Record<string, unknown>).instantly_id = null;
              (changes as Record<string, unknown>).instantly_campaign = null;
              summary.removed_from_instantly++;
            }
            if (lead.tag !== "catchall") changes.tag = "catchall";
            if (Object.keys(changes).length > 0) {
              await updateLead(lead.id, changes);
            }
            summary.risky++;
          } catch (err) {
            summary.errors++;
            logger.error("backfill_risky failed", {
              lead_id: lead.id,
              error: (err as Error).message,
            });
          }
        }
        return summary;
      }

      const toProcess = leads.filter((l) => l.email_status == null && l.apollo_id);
      if (toProcess.length === 0) return summary;

      const apollo = createApolloClient();
      const instantly = createInstantlyClient();
      const resolveHubSpot = makeHubSpotResolver();

      const enrichResponse = await apollo.bulkEnrichPeople(
        toProcess.map((lead) => ({
          id: lead.apollo_id!,
          first_name: lead.first_name || undefined,
          organization_name: lead.company_name || undefined,
          linkedin_url: lead.linkedin_url || undefined,
        })),
      );
      const enrichedPeople = enrichResponse.matches;

      for (let i = 0; i < toProcess.length; i++) {
        const lead = toProcess[i]!;
        const person = enrichedPeople[i];

        try {
          if (!person) {
            await updateLead(lead.id, { email_status: "unknown" });
            summary.unknown++;
            continue;
          }

          const evaluation = evaluateEmail(person);
          const changes: Partial<Lead> = { email_status: evaluation.emailStatus };

          events.push({
            lead_id: lead.id,
            event_type: "email_verified",
            source_system: "apollo",
            workflow: "WF-5",
            sequence_step: 5,
            detail: {
              run_id: runId,
              apollo_email_status: person.email_status,
              catch_all: person.email_domain_catchall,
              extrapolated: !!person.extrapolated_email_confidence,
              result_status: evaluation.emailStatus,
              reason: evaluation.reason,
            },
          });

          if (evaluation.emailStatus === "valid") {
            summary.valid++;
          } else if (evaluation.emailStatus === "invalid") {
            summary.invalid++;
            summary.suppressed++;

            let instantlyDeleted = false;
            if (lead.instantly_id) {
              try {
                await instantly.deleteLead(lead.instantly_id);
                instantlyDeleted = true;
                summary.removed_from_instantly++;
              } catch (e) {
                logger.warn("instantly delete failed (invalid)", {
                  lead_id: lead.id,
                  error: (e as Error).message,
                });
              }
            }

            Object.assign(changes, {
              funnel_stage: "suppressed",
              suppression_reason: "email_invalid",
              suppressed_at: new Date().toISOString(),
              ...(instantlyDeleted
                ? { instantly_id: null, instantly_campaign: null }
                : {}),
            });

            if (lead.hubspot_contact_id && lead.company_id) {
              try {
                const hubspot = await resolveHubSpot(lead.company_id);
                if (hubspot) {
                  await hubspot.updateContact(lead.hubspot_contact_id, {
                    hs_lead_status: "BAD_TIMING",
                    suppressed: "true",
                    suppression_reason: "email_invalid",
                  });
                } else {
                  logger.warn("hubspot not configured for company", {
                    lead_id: lead.id,
                    company_id: lead.company_id,
                  });
                }
              } catch (e) {
                logger.warn("hubspot update failed (invalid)", {
                  lead_id: lead.id,
                  error: (e as Error).message,
                });
              }
            }

            events.push({
              lead_id: lead.id,
              event_type: "suppressed",
              source_system: "system",
              workflow: "WF-5",
              sequence_step: 5,
              detail: {
                run_id: runId,
                reason: evaluation.reason,
                instantly_removed: !!lead.instantly_id,
              },
            });
          } else if (evaluation.emailStatus === "risky") {
            summary.risky++;
            changes.tag = "catchall";
            if (lead.instantly_id) {
              try {
                await instantly.deleteLead(lead.instantly_id);
                (changes as Record<string, unknown>).instantly_id = null;
                (changes as Record<string, unknown>).instantly_campaign = null;
                summary.removed_from_instantly++;
              } catch (e) {
                logger.warn("instantly delete failed (risky)", {
                  lead_id: lead.id,
                  error: (e as Error).message,
                });
              }
            }
          } else {
            summary.unknown++;
          }

          await updateLead(lead.id, changes);
        } catch (err) {
          summary.errors++;
          logger.error("lead processing failed", {
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
