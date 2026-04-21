export interface HubSpotContact {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    jobtitle?: string;
    company?: string;
    phone?: string;
    hs_linkedin_url?: string;
    persona_type?: string;
    icp_score?: string;
    icp_tier?: string;
    qualification_status?: string;
    suppressed?: string;
    suppression_reason?: string;
    lifecyclestage?: string;
    hs_email_optout?: string;
    hs_email_bounce?: string;
    notes_last_contacted?: string;
    apollo_sync_date?: string;
    qualification_date?: string;
    hs_lead_status?: string;
    lift_ai_summary?: string;
    lift_ai_fit_tag?: string;
    lift_ai_signals?: string;
    lift_ai_phone?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface HubSpotCompany {
  id: string;
  properties: {
    domain?: string;
    name?: string;
    industry?: string;
    numberofemployees?: string;
    lifecyclestage?: string;
    hs_current_customer?: string;
  };
}

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname?: string;
    dealstage?: string;
    amount?: string;
    closedate?: string;
    pipeline?: string;
    hs_is_closed_won?: string;
    hs_is_closed_lost?: string;
  };
}
