import { schemaTask, logger } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  createHeyReachClient,
  type HeyReachAccountLeadPair,
} from "../../lib/heyreach/index.js";
import {
  createSupabaseClient,
  getCompanyById,
  logEvents,
  updateLead,
  type Lead,
  type LeadEvent,
} from "../../lib/supabase/index.js";

const payloadSchema = z.object({
  companyId: z.string().uuid(),
  batchId: z.string(),
  leadIds: z.array(z.string().uuid()).min(1),
});

export interface EnrollColdSummary {
  attempted: number;
  enrolled: number;
  failed: number;
  skipped_missing_campaign: number;
}

/**
 * Cold bucket: enroll qualified leads into a HeyReach connection-request
 * campaign. No agent involvement — the decision to enroll is made by the
 * bucket query in the parent cron.
 */
export const enrollCold = schemaTask({
  id: "enroll-cold",
  schema: payloadSchema,
  maxDuration: 900,
  run: async ({ companyId, batchId, leadIds }): Promise<EnrollColdSummary> => {
    const summary: EnrollColdSummary = {
      attempted: leadIds.length,
      enrolled: 0,
      failed: 0,
      skipped_missing_campaign: 0,
    };

    const company = await getCompanyById(companyId);
    const campaignMap = company.heyreach_conn_req_campaigns ?? {};
    if (Object.keys(campaignMap).length === 0) {
      logger.warn("enroll-cold: company has no heyreach_conn_req_campaigns", {
        companyId,
      });
      summary.skipped_missing_campaign = leadIds.length;
      return summary;
    }

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .in("id", leadIds);
    if (error) {
      throw new Error(`enroll-cold load leads: ${error.message}`);
    }
    const leads = (data ?? []) as Lead[];

    // Group by persona → campaign. Leads whose persona isn't mapped are
    // counted under skipped_missing_campaign and left untouched.
    const groups = new Map<string, { campaignId: number; leads: Lead[] }>();
    for (const lead of leads) {
      if (!lead.persona_type) {
        summary.skipped_missing_campaign++;
        continue;
      }
      if (!lead.linkedin_url) {
        summary.skipped_missing_campaign++;
        continue;
      }
      const campaignId = campaignMap[lead.persona_type];
      if (typeof campaignId !== "number") {
        summary.skipped_missing_campaign++;
        continue;
      }
      const existing = groups.get(lead.persona_type);
      if (existing) {
        existing.leads.push(lead);
      } else {
        groups.set(lead.persona_type, { campaignId, leads: [lead] });
      }
    }

    const heyreach = createHeyReachClient();
    const events: LeadEvent[] = [];
    const now = new Date().toISOString();

    for (const [personaName, group] of groups.entries()) {
      const accountLeadPairs: HeyReachAccountLeadPair[] = group.leads
        .filter((l): l is Lead & { linkedin_url: string } => !!l.linkedin_url)
        .map((l) => ({
          // HeyReach routes to one of our connected accounts via the
          // campaign's settings; we don't need to pass linkedInAccountId
          // here, but the SDK shape requires it. Using 0 is the documented
          // "pick for me" sentinel when accountLeadPairs has no pinned
          // sender.
          linkedInAccountId: company.heyreach_linkedin_account_id ?? 0,
          lead: {
            profileUrl: l.linkedin_url,
            firstName: l.first_name ?? undefined,
            lastName: l.last_name ?? undefined,
            companyName: l.company_name ?? undefined,
            position: l.title ?? undefined,
            emailAddress: l.email,
          },
        }));

      try {
        const result = await heyreach.addLeadsToCampaign({
          campaignId: group.campaignId,
          accountLeadPairs,
          resumePausedCampaign: true,
        });
        logger.info("enroll-cold HeyReach add_leads_to_campaign", {
          companyId,
          personaName,
          campaignId: group.campaignId,
          ...result,
        });

        for (const lead of group.leads) {
          await updateLead(lead.id, {
            funnel_stage: "enrolled",
            enrolled_at: now,
            heyreach_campaign: personaName,
          });
          events.push({
            lead_id: lead.id,
            event_type: "connection_request_enrolled",
            source_system: "gtm-jobs",
            workflow: "WF-4",
            sequence_step: 4,
            campaign_name: personaName,
            detail: {
              batch_id: batchId,
              heyreach_campaign_id: group.campaignId,
              persona_type: personaName,
            },
          });
          summary.enrolled++;
        }
      } catch (err) {
        summary.failed += group.leads.length;
        logger.error("enroll-cold HeyReach call failed", {
          companyId,
          personaName,
          campaignId: group.campaignId,
          error: (err as Error).message,
        });
      }
    }

    await logEvents(events);
    return summary;
  },
});
