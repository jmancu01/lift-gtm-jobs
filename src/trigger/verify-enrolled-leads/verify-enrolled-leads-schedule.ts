import { schedules } from "@trigger.dev/sdk";
import { verifyEnrolledLeads } from "./index.js";

const DEFAULT_LIMIT = 500;

export const verifyEnrolledLeadsSchedule = schedules.task({
  id: "verify-enrolled-leads-schedule",
  cron: "0 */6 * * *",
  run: async () => {
    const handle = await verifyEnrolledLeads.trigger({
      limit: DEFAULT_LIMIT,
      mode: "verify",
      dryRun: false,
    });
    return { triggered_run_id: handle.id };
  },
});
