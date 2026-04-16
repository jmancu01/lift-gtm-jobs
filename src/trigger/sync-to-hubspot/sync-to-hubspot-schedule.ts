import { schedules } from "@trigger.dev/sdk";
import { getActiveCompanies } from "../../lib/supabase/index.js";
import { syncToHubspot } from "./index.js";

const DEFAULT_LIMIT = 100;

export const syncToHubspotSchedule = schedules.task({
  id: "sync-to-hubspot-schedule",
  cron: "*/30 * * * *",
  run: async () => {
    const companies = await getActiveCompanies();
    const triggered: { company_id: string; run_id: string }[] = [];
    for (const c of companies) {
      if (!c.hubspot_access_token) continue;
      const handle = await syncToHubspot.trigger({
        companyId: c.id,
        limit: DEFAULT_LIMIT,
        dryRun: false,
      });
      triggered.push({ company_id: c.id, run_id: handle.id });
    }
    return { triggered_count: triggered.length, triggered };
  },
});
