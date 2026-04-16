import { task, queue, logger } from "@trigger.dev/sdk";
import {
  createApolloClient,
  buildFiltersFromIcp,
  qualityFilter,
  type ApolloEnrichedPerson,
} from "../../lib/apollo/index.js";
import {
  logEvents,
  insertLead,
  findExistingApolloIds,
  leadExistsByEmail,
  type IcpConfig,
  type IcpPersona,
  type LeadEvent,
} from "../../lib/supabase/index.js";
import {
  delay,
  extractDomain,
  personaTypeFromGroup,
} from "../../lib/helpers/index.js";
import type { PersonaResult } from "./types.js";

const ENRICH_BATCH_SIZE = 10;
const MAX_PAGE = 500;
const DELAY_BETWEEN_API_CALLS_MS = 1_000;

const apolloSearchQueue = queue({
  name: "apollo-search",
  concurrencyLimit: 3,
});

/**
 * Discovers leads for one persona: paginates Apollo search, pre-filters
 * already-known apollo_ids, enriches in batches, applies quality filter,
 * dedups by email, creates Apollo contact, inserts into Supabase.
 * All scoped by companyId.
 */
export const discoverLeadsForPersona = task({
  id: "discover-leads-for-persona",
  queue: apolloSearchQueue,
  maxDuration: 1_800,
  retry: { maxAttempts: 1 },
  run: async (payload: {
    companyId: string;
    runId: string;
    persona: IcpPersona;
    icp: IcpConfig;
    apolloContactStageId: string | null;
    personaTarget: number;
    perPage: number;
    dryRun: boolean;
  }): Promise<PersonaResult> => {
    const {
      companyId,
      runId,
      persona,
      icp,
      apolloContactStageId,
      personaTarget,
      perPage,
      dryRun,
    } = payload;

    const result: PersonaResult = {
      personaName: persona.name,
      inserted: 0,
      leadIds: [],
      pagesSearched: 0,
      searchResults: 0,
      enriched: 0,
      duplicatesSkipped: 0,
      qualityFiltered: {},
      errors: 0,
    };

    const apollo = createApolloClient();
    const events: LeadEvent[] = [];

    try {
      let page = 1;
      while (result.inserted < personaTarget && page <= MAX_PAGE) {
        const filters = buildFiltersFromIcp(icp, persona, page, perPage);
        const searchResponse = await apollo.searchPeople(filters);
        const people = searchResponse.people;
        result.searchResults += people.length;
        result.pagesSearched = page;

        logger.info(`[${persona.name}] page ${page}`, {
          companyId,
          results: people.length,
          total_entries: searchResponse.total_entries,
        });

        if (people.length === 0) break;

        for (
          let batchStart = 0;
          batchStart < people.length;
          batchStart += ENRICH_BATCH_SIZE
        ) {
          if (result.inserted >= personaTarget) break;

          const batch = people.slice(batchStart, batchStart + ENRICH_BATCH_SIZE);
          const batchIds = batch.map((p) => p.id);
          const existing = await findExistingApolloIds(companyId, batchIds);
          const newBatch = batch.filter((p) => !existing.has(p.id));
          if (existing.size > 0) result.duplicatesSkipped += existing.size;
          if (newBatch.length === 0) continue;

          const enrichResponse = await apollo.bulkEnrichPeople(
            newBatch.map((p) => ({
              id: p.id,
              first_name: p.first_name,
              organization_name: p.organization?.name || "",
            })),
          );
          const enriched = enrichResponse.matches.filter(
            (m): m is ApolloEnrichedPerson => m !== null,
          );
          result.enriched += enriched.length;

          for (const person of enriched) {
            if (result.inserted >= personaTarget) break;

            const qf = qualityFilter(person, icp);
            if (!qf.passed) {
              const reason = qf.reason || "unknown";
              result.qualityFiltered[reason] =
                (result.qualityFiltered[reason] || 0) + 1;
              continue;
            }

            if (await leadExistsByEmail(companyId, person.email)) {
              result.duplicatesSkipped++;
              continue;
            }

            if (dryRun) {
              result.inserted++;
              continue;
            }

            try {
              const labelNames = person.organization?.keywords?.slice(0, 5) || [];
              await apollo.createContact({
                first_name: person.first_name,
                last_name: person.last_name,
                title: person.title,
                organization_name: person.organization?.name,
                email: person.email,
                linkedin_url: person.linkedin_url,
                label_names: labelNames,
                ...(apolloContactStageId
                  ? { contact_stage_id: apolloContactStageId }
                  : {}),
              });

              const inserted = await insertLead({
                company_id: companyId,
                email: person.email,
                first_name: person.first_name,
                last_name: person.last_name,
                title: person.title,
                company_name: person.organization?.name ?? null,
                company_domain: extractDomain(person.organization?.website_url),
                linkedin_url: person.linkedin_url || null,
                employee_count:
                  person.organization?.estimated_num_employees ?? null,
                industry: person.organization?.industry ?? null,
                funnel_stage: "discovered",
                persona_type: personaTypeFromGroup(persona.name),
                icp_score: null,
                icp_tier: null,
                qualification_status: null,
                suppression_reason: null,
                hubspot_contact_id: null,
                hubspot_company_id: null,
                instantly_id: null,
                instantly_campaign: null,
                heyreach_campaign: null,
                sequence_name: null,
                apollo_id: person.id,
                apollo_action: "found",
                email_status: person.email_domain_catchall ? "risky" : "valid",
                soft_bounce_count: 0,
                synced_at: null,
                qualified_at: null,
                suppressed_at: null,
                enrolled_at: null,
                discovered_at: new Date().toISOString(),
                tag: person.email_domain_catchall ? "catchall" : null,
              });

              result.inserted++;
              result.leadIds.push(inserted.id);

              events.push({
                lead_id: inserted.id,
                event_type: "discovered",
                source_system: "apollo",
                workflow: "WF-1",
                sequence_step: 1,
                detail: {
                  run_id: runId,
                  company_id: companyId,
                  persona_group: persona.name,
                  apollo_id: person.id,
                },
              });
            } catch (err) {
              result.errors++;
              logger.error("insert failed", {
                persona: persona.name,
                email: person.email,
                error: (err as Error).message,
              });
            }
          }

          if (batchStart + ENRICH_BATCH_SIZE < people.length) {
            await delay(DELAY_BETWEEN_API_CALLS_MS);
          }
        }

        if (page * perPage >= searchResponse.total_entries) break;
        page++;
        await delay(DELAY_BETWEEN_API_CALLS_MS);
      }

      return result;
    } finally {
      await logEvents(events);
    }
  },
});
