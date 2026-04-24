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

// --- outreach-orchestrator (outreach.v1) ---
// Contracts mirror agentapi/agents/outreach-orchestrator/PLAN.md §4-§5.

export type OutreachTone = "formal" | "conversational" | "technical";
export type OutreachValueProp =
  | "operational_efficiency"
  | "post_ma_integration"
  | "digital_transformation"
  | "process_improvement";

export interface OutreachResearch {
  company_summary: string | null;
  role_summary: string | null;
  recent_news: string | null;
  pain_points: string[];
  recommended_tone: OutreachTone | null;
  recommended_value_prop: OutreachValueProp | null;
}

export interface FirstDmLead {
  input_type: "first_dm";
  lead_id: string;
  name: string;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  persona_type: string | null;
  icp_tier: FitTier | null;
  connection_accepted_at: string;
  research: OutreachResearch;
  scout_copy: { linkedin_dm: string };
}

export interface ConversationMessage {
  from: "us" | "them";
  text: string;
  at: string;
}

export interface ReplyLead {
  input_type: "reply";
  lead_id: string;
  name: string;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  persona_type: string | null;
  icp_tier: FitTier | null;
  research: OutreachResearch;
  conversation: ConversationMessage[];
}

export type OutreachLead = FirstDmLead | ReplyLead;

export interface OutreachBatch {
  batch_id: string;
  as_of: string;
  leads: OutreachLead[];
}

export type ReplyIntent =
  | "engaged_positive"
  | "asking_for_info"
  | "objection_or_cold"
  | "out_of_scope"
  | "negative_or_unsubscribe";

export interface FirstDmResult {
  lead_id: string;
  input_type: "first_dm";
  status: "ready_to_send";
  copy_source: "scout_passthrough" | "override";
  message: string;
  reasoning: string;
}

export interface ReplyReadyResult {
  lead_id: string;
  input_type: "reply";
  status: "ready_to_send";
  intent: ReplyIntent;
  conversation_summary: string;
  message: string;
  reasoning: string;
}

export interface ReplyHeldResult {
  lead_id: string;
  input_type: "reply";
  status: "held_for_human";
  intent: ReplyIntent;
  conversation_summary: string;
  hold_reason: string;
  suggested_draft: string;
}

export type OutreachResult = FirstDmResult | ReplyReadyResult | ReplyHeldResult;

export interface OutreachReceipt {
  batch_id: string;
  results: OutreachResult[];
}
