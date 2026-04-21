import type { QualifySummary } from "./types.js";

export const emptySummary = (): QualifySummary => ({
  successful: 0,
  failed: 0,
  qualified: 0,
  not_qualified: 0,
  schema_failures: 0,
  hubspot_updated: 0,
  hubspot_missing: 0,
  by_fit: { A: 0, B: 0, C: 0, Unknown: 0 },
});
