export interface BatchSummary {
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
  errors: number;
  suppressed: number;
  removed_from_instantly: number;
}
