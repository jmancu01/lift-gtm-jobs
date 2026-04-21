export type FunnelStage =
  | "discovered"
  | "synced"
  | "qualified"
  | "enrolled"
  | "contacted"
  | "engaging"
  | "replied"
  | "meeting_booked"
  | "suppressed"
  | "nurture";

export type QualificationStatus =
  | "pending"
  | "ready"
  | "suppressed"
  | "incomplete";

export type IcpTier = "A" | "B" | "C";

export interface Lead {
  id: string;
  company_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company_name: string | null;
  company_domain: string | null;
  linkedin_url: string | null;
  employee_count: number | null;
  industry: string | null;
  funnel_stage: FunnelStage;
  persona_type: string | null;
  icp_score: number | null;
  icp_tier: IcpTier | null;
  qualification_status: QualificationStatus | null;
  suppression_reason: string | null;
  hubspot_contact_id: string | null;
  hubspot_company_id: string | null;
  instantly_id: string | null;
  instantly_campaign: string | null;
  heyreach_campaign: string | null;
  sequence_name: string | null;
  apollo_id: string | null;
  apollo_action: string | null;
  email_status: string | null;
  soft_bounce_count: number;
  synced_at: string | null;
  qualified_at: string | null;
  suppressed_at: string | null;
  enrolled_at: string | null;
  discovered_at: string | null;
  tag: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadEvent {
  lead_id: string;
  event_type: string;
  source_system: string;
  workflow: string;
  sequence_step: number;
  campaign_name?: string | null;
  detail?: Record<string, unknown> | null;
  created_at?: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  hubspot_access_token: string | null;
  hubspot_portal_id: string | null;
  apollo_contact_stage_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadAiResearch {
  id: string;
  lead_id: string;
  company_id: string;
  fit_tag: "A" | "B" | "C";
  fit_justification: string;
  confidence: number;
  research_quality: "high" | "medium" | "low";
  summary: string;
  signals: string;
  phone: string | null;
  phone_source: string | null;
  talking_points: string[];
  pain_points: string[];
  recent_activity: string[];
  sources: string[];
  company_summary: string | null;
  industry: string | null;
  company_size: string | null;
  run_id: string | null;
  schema_version: string;
  created_at: string;
  superseded_at: string | null;
}

export type NewLeadAiResearch = Omit<
  LeadAiResearch,
  "id" | "created_at" | "superseded_at" | "schema_version"
> & { schema_version?: string };

export interface IcpPersona {
  name: string;
  titles: string[];
}

export interface IcpConfig {
  id: string;
  company_id: string;
  version: number;
  is_active: boolean;
  person_locations: string[] | null;
  organization_industries: string[] | null;
  organization_num_employees_ranges: string[] | null;
  person_seniorities: string[] | null;
  contact_email_status: string;
  q_organization_domains_list: string[] | null;
  q_keywords: string | null;
  personas: IcpPersona[];
  max_stale_days: number;
  reject_extrapolated: boolean;
  created_at: string;
}
