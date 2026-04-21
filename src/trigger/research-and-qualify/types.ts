import type { FitTier } from "../../lib/agentapi/index.js";

export interface QualifySummary {
  successful: number;
  failed: number;
  qualified: number;
  not_qualified: number;
  schema_failures: number;
  hubspot_updated: number;
  hubspot_missing: number;
  by_fit: Record<FitTier | "Unknown", number>;
}
