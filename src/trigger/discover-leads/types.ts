export interface PersonaResult {
  personaName: string;
  inserted: number;
  leadIds: string[];
  pagesSearched: number;
  searchResults: number;
  enriched: number;
  duplicatesSkipped: number;
  qualityFiltered: Record<string, number>;
  errors: number;
}
