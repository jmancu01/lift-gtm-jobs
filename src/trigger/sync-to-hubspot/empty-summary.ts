import type { SyncSummary } from "./types.js";

export const emptySummary = (): SyncSummary => ({
  successful: 0,
  failed: 0,
  contacts_created: 0,
  contacts_updated: 0,
  companies_created: 0,
  companies_linked: 0,
});
