import { schedules, logger, metadata, tags } from "@trigger.dev/sdk";
import { randomUUID } from "node:crypto";
import {
  getActiveCompanies,
  type Company,
} from "../../lib/supabase/index.js";
import {
  fetchColdBucket,
  fetchFirstDmBucket,
  fetchReplyBucket,
} from "./buckets.js";
import { enrollCold } from "./enroll-cold.js";
import { composeAndSend } from "./compose-and-send.js";

const BUCKET_CAP = 100;

/**
 * Outreach dispatch cron — every 30 min during US working hours.
 *
 * Per company:
 *   - cold bucket → enrollCold (HeyReach add_leads_to_campaign, no agent)
 *   - first_dm + reply buckets → composeAndSend (calls outreach-orchestrator
 *                                                via AgentAPI)
 *
 * The cron is registered here but NOT yet scheduled in the Trigger.dev
 * dashboard — per docs/outreach-functions.md §10 rollout step 5, deploy
 * paused and enable after smoke test.
 */
export const outreachDispatch = schedules.task({
  id: "outreach-dispatch",
  cron: { pattern: "*/30 9-18 * * 1-5", timezone: "America/New_York" },
  maxDuration: 1_800,
  run: async () => {
    const runId = randomUUID();
    await tags.add([`run_${runId}`]);
    logger.info("outreach-dispatch starting", { runId });

    const allCompanies = await getActiveCompanies();
    const eligibleCompanies = allCompanies.filter(
      (c): c is Company & { heyreach_linkedin_account_id: number } =>
        c.heyreach_linkedin_account_id != null,
    );

    let totalCold = 0;
    let totalFirstDm = 0;
    let totalReply = 0;
    const fanouts: Promise<unknown>[] = [];

    for (const company of eligibleCompanies) {
      const personaKeys = Object.keys(
        company.heyreach_conn_req_campaigns ?? {},
      );

      const [cold, firstDm, reply] = await Promise.all([
        fetchColdBucket(company.id, personaKeys, BUCKET_CAP),
        fetchFirstDmBucket(company.id, BUCKET_CAP),
        fetchReplyBucket(company.id, BUCKET_CAP),
      ]);

      totalCold += cold.length;
      totalFirstDm += firstDm.length;
      totalReply += reply.length;

      logger.info("outreach-dispatch buckets sized", {
        company_id: company.id,
        cold: cold.length,
        first_dm: firstDm.length,
        reply: reply.length,
      });

      const asOf = new Date().toISOString();
      const batchId = `${asOf}/${company.id}/${runId}`;

      if (cold.length > 0) {
        fanouts.push(
          enrollCold.trigger({
            companyId: company.id,
            batchId,
            leadIds: cold.map((c) => c.lead.id),
          }),
        );
      }

      if (firstDm.length > 0 || reply.length > 0) {
        fanouts.push(
          composeAndSend.trigger({
            companyId: company.id,
            batchId,
            firstDmLeadIds: firstDm.map((c) => c.lead.id),
            replyLeadIds: reply.map((c) => c.lead.id),
          }),
        );
      }
    }

    await Promise.all(fanouts);

    metadata
      .set("total_companies", eligibleCompanies.length)
      .set("total_cold", totalCold)
      .set("total_first_dm", totalFirstDm)
      .set("total_reply", totalReply);

    logger.info("outreach-dispatch fan-out complete", {
      runId,
      companies: eligibleCompanies.length,
      cold: totalCold,
      first_dm: totalFirstDm,
      reply: totalReply,
    });

    return {
      run_id: runId,
      total_companies: eligibleCompanies.length,
      total_cold: totalCold,
      total_first_dm: totalFirstDm,
      total_reply: totalReply,
    };
  },
});
