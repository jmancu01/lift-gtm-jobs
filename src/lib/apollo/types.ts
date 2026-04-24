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

export interface ApolloPhoneNumber {
  raw_number?: string | null;
  sanitized_number?: string | null;
  type?: string | null;
  position?: number | null;
  status?: string | null;
  dnc_status?: string | null;
  dnc_other_info?: string | null;
  source?: string | null;
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
  phone_numbers?: ApolloPhoneNumber[];
  sanitized_phone?: string | null;
  mobile_phone?: string | null;
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

export interface ApolloContact {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  title?: string | null;
  person_id?: string | null;
  phone_numbers?: ApolloPhoneNumber[];
  sanitized_phone?: string | null;
}

export interface ApolloContactsSearchResponse {
  contacts: ApolloContact[];
  pagination?: {
    total_entries?: number;
    per_page?: number;
    page?: number;
  };
}
