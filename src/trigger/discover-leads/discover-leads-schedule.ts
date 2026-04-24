// Disabled: Apollo credits exhausted. Re-enable by uncommenting and redeploying.
// import { schedules } from "@trigger.dev/sdk";
// import { getActiveCompanies } from "../../lib/supabase/index.js";
// import { discoverLeads } from "./index.js";
//
// const DEFAULT_TARGET = 50;
// const DEFAULT_PER_PAGE = 25;
//
// export const discoverLeadsSchedule = schedules.task({
//   id: "discover-leads-schedule",
//   cron: "0 */12 * * *",
//   run: async () => {
//     const companies = await getActiveCompanies();
//     const triggered: { company_id: string; run_id: string }[] = [];
//     for (const c of companies) {
//       const handle = await discoverLeads.trigger({
//         companyId: c.id,
//         target: DEFAULT_TARGET,
//         perPage: DEFAULT_PER_PAGE,
//         dryRun: false,
//       });
//       triggered.push({ company_id: c.id, run_id: handle.id });
//     }
//     return { triggered_count: triggered.length, triggered };
//   },
// });
export {};
