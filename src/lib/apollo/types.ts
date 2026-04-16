export interface ApolloSearchFilters {
  person_titles?: string[];
  person_seniorities?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  organization_industries?: string[];
  q_organization_domains_list?: string[];
  organization_num_employees_ranges?: string[];
  contact_email_status?: string;
  prospected_by_current_team?: string[];
  q_keywords?: string;
  per_page?: number;
  page?: number;
}

export interface ApolloSearchPerson {
  id: string;
  first_name: string;
  last_name_obfuscated?: string;
  title: string;
  last_refreshed_at?: string;
  has_email?: boolean;
  organization?: { name: string };
}

export interface ApolloSearchResponse {
  total_entries: number;
  people: ApolloSearchPerson[];
}

export interface ApolloEnrichedPerson {
  id: string;
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  email_status: string;
  email_domain_catchall: boolean | null;
  extrapolated_email_confidence: number | null;
  linkedin_url: string;
  last_refreshed_at: string | null;
  organization?: {
    id: string;
    name: string;
    website_url?: string;
    industry?: string;
    estimated_num_employees?: number;
    keywords?: string[];
  };
}

export interface ApolloBulkEnrichRequest {
  details: {
    id?: string;
    first_name?: string;
    organization_name?: string;
    linkedin_url?: string;
  }[];
  reveal_personal_emails?: boolean;
}

export interface ApolloBulkEnrichResponse {
  status: string;
  matches: (ApolloEnrichedPerson | null)[];
}

export interface ApolloCreateContactInput {
  first_name?: string;
  last_name?: string;
  title?: string;
  organization_name?: string;
  email?: string;
  linkedin_url?: string;
  label_names?: string[];
  contact_stage_id?: string;
}

export interface ApolloContactResponse {
  contact: { id: string; [key: string]: unknown };
}
