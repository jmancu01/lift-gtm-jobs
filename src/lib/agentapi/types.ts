/** What the scout.v1 schema returns for fit_probability / lift_ai_fit_tag. */
export type FitTag = "High" | "Medium" | "Low";
/** GTM engine's internal tier vocabulary. A = best fit. */
export type FitTier = "A" | "B" | "C";
export type ResearchQuality = "high" | "medium" | "low";

export function scoutFitToTier(fit: FitTag): FitTier {
  switch (fit) {
    case "High":
      return "A";
    case "Medium":
      return "B";
    case "Low":
      return "C";
  }
}

export interface ScoutPayload {
  name: string;
  role: string;
  company: string;
  company_summary: string;
  industry: string;
  company_size: string;
  recent_activity: string[];
  talking_points: string[];
  pain_points: string[];
  fit_probability: FitTag;
  fit_justification: string;
  phone_number: string | null;
  phone_source: string | null;
  hubspot_properties: {
    lift_ai_summary: string;
    lift_ai_fit_tag: FitTag;
    lift_ai_signals: string;
    lift_ai_phone: string | null;
  };
  confidence: number;
  sources: string[];
  research_quality: ResearchQuality;
}

export interface AskResponse<T = unknown> {
  response: string;
  parsed?: T;
  schema?: string;
  lead_id?: string;
  retried?: boolean;
}

export interface AskErrorBody {
  schema?: string;
  retried?: boolean;
  response?: string;
  error?: string;
  kind?: "invalid_json" | "schema_mismatch";
}

export class AgentApiSchemaError extends Error {
  constructor(
    message: string,
    public readonly body: AskErrorBody,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AgentApiSchemaError";
  }
}
