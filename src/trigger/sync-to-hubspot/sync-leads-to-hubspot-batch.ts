import { task, queue, logger } from "@trigger.dev/sdk";
import {
  updateLead,
  logEvents,
  type Lead,
  type LeadEvent,
} from "../../lib/supabase/index.js";
import {
  createHubSpotClient,
  contactPropertiesFromLead,
  mapIndustry,
} from "../../lib/hubspot/index.js";
import { emptySummary } from "./empty-summary.js";
import type { SyncSummary } from "./types.js";

// HubSpot Private App tokens are rate-limited per portal (~100-190 req/10s).
// Each lead issues ~4-6 calls (search/create/update/associate), and each batch
// processes leads sequentially, so 3 parallel batches ≈ 15-20 concurrent calls.
// The client's internal 429 backoff absorbs brief overages.
const hubspotQueue = queue({
  name: "hubspot",
  concurrencyLimit: 3,
});

/**
 * Processes one batch of leads through HubSpot sync for a specific company's
 * portal. Retries disabled — failed leads stay in funnel_stage=discovered and
 * are redriven by the next parent run via its query filter, which keeps the
 * task idempotent without needing per-event dedup in the database.
 */
export const syncLeadsToHubspotBatch = task({
  id: "sync-leads-to-hubspot-batch",
  queue: hubspotQueue,
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async (payload: {
    leads: Lead[];
    runId: string;
    companyId: string;
    hubspotAccessToken: string;
    dryRun: boolean;
  }): Promise<SyncSummary> => {
    const { leads, runId, companyId, hubspotAccessToken, dryRun } = payload;
    const summary = emptySummary();
    const events: LeadEvent[] = [];
    const hubspot = createHubSpotClient(hubspotAccessToken);

    try {
      for (const lead of leads) {
        try {
          const existingContact = await hubspot.searchContacts(lead.email);
          let contactId: string;

          if (existingContact) {
            contactId = existingContact.id;
            if (!dryRun) {
              await hubspot.updateContact(
                contactId,
                contactPropertiesFromLead(lead),
              );
            }
            summary.contacts_updated++;
          } else {
            if (!dryRun) {
              const created = await hubspot.createContact({
                email: lead.email,
                ...contactPropertiesFromLead(lead),
              });
              contactId = created.id;
            } else {
              contactId = "dry-run-contact-id";
            }
            summary.contacts_created++;
          }

          let companyHsId: string | undefined;
          if (lead.company_domain) {
            const existingCompany = await hubspot.searchCompanies(
              lead.company_domain,
            );
            if (existingCompany) {
              companyHsId = existingCompany.id;
            } else if (!dryRun) {
              const newCompany = await hubspot.createCompany({
                name: lead.company_name || "",
                domain: lead.company_domain,
                industry: mapIndustry(lead.industry),
                numberofemployees: lead.employee_count?.toString() || "",
              });
              companyHsId = newCompany.id;
              summary.companies_created++;
            } else {
              companyHsId = "dry-run-company-id";
            }

            if (companyHsId && !dryRun) {
              await hubspot.associateContactToCompany(contactId, companyHsId);
              summary.companies_linked++;
            }
          }

          if (!dryRun) {
            await updateLead(lead.id, {
              hubspot_contact_id: contactId,
              hubspot_company_id: companyHsId ?? null,
              funnel_stage: "synced",
              synced_at: new Date().toISOString(),
            });

            events.push({
              lead_id: lead.id,
              event_type: "synced_to_hubspot",
              source_system: "hubspot",
              workflow: "WF-2",
              sequence_step: 2,
              detail: {
                run_id: runId,
                company_id: companyId,
                hubspot_contact_id: contactId,
                hubspot_company_id: companyHsId ?? null,
                created_contact: !existingContact,
              },
            });
          }

          summary.successful++;
        } catch (err) {
          summary.failed++;
          logger.error("hubspot sync failed for lead", {
            lead_id: lead.id,
            email: lead.email,
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
