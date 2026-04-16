import type { BatchSummary } from "./types.js";

export const emptySummary = (): BatchSummary => ({
  valid: 0,
  invalid: 0,
  risky: 0,
  unknown: 0,
  errors: 0,
  suppressed: 0,
  removed_from_instantly: 0,
});
