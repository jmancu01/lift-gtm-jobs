import { schemaTask, logger, metadata, tags } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  generateRunId,
  getCompanyById,
  getRecentLeadsMissingPhone,
  updateLead,
} from "../../lib/supabase/index.js";
import { createApolloClient } from "../../lib/apollo/index.js";
import type {
  ApolloContact,
  ApolloPhoneNumber,
} from "../../lib/apollo/types.js";

const DEFAULT_LIMIT = 50;
const REQUEST_PACE_MS = 300;

const payloadSchema = z.object({
  companyId: z.string().uuid(),
  limit: z.number().int().positive().max(500).default(DEFAULT_LIMIT),
  dryRun: z.boolean().default(false),
});

interface PhonePick {
  phone: string;
  phone_type: string | null;
  phone_status: string | null;
  phone_source: string;
}

function pickBestPhone(contact: ApolloContact): PhonePick | null {
  const candidates: ApolloPhoneNumber[] = contact.phone_numbers ?? [];
  if (candidates.length === 0) {
    if (!contact.sanitized_phone) return null;
    return {
      phone: contact.sanitized_phone,
      phone_type: null,
      phone_status: null,
      phone_source: "apollo_contact",
    };
  }
  const sorted = [...candidates].sort((a, b) => {
    const rank = (p: ApolloPhoneNumber) =>
      p.type === "mobile" ? 0 : p.type === "work" ? 1 : 2;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return (a.position ?? 99) - (b.position ?? 99);
  });
  const pick = sorted[0]!;
  const number = pick.sanitized_number || pick.raw_number;
  if (!number) return null;
  return {
    phone: number,
    phone_type: pick.type ?? null,
    phone_status: pick.status ?? null,
    phone_source: pick.source ?? "apollo_contact",
  };
}

function matchContactByEmail(
  contacts: ApolloContact[],
  email: string,
): ApolloContact | null {
  const target = email.trim().toLowerCase();
  return (
    contacts.find((c) => (c.email ?? "").trim().toLowerCase() === target) ??
    null
  );
}

export const backfillApolloPhones = schemaTask({
  id: "backfill-apollo-phones",
  schema: payloadSchema,
  maxDuration: 1_800,
  run: async ({ companyId, limit, dryRun }) => {
    const runId = generateRunId();
    await tags.add([
      `run_${runId}`,
      `company_${companyId}`,
      dryRun ? "dry_run" : "live",
    ]);

    logger.info("backfill-apollo-phones starting", {
      runId,
      companyId,
      limit,
      dryRun,
    });

    const company = await getCompanyById(companyId);
    const leads = await getRecentLeadsMissingPhone(companyId, limit);
    logger.info("fetched leads missing phone", {
      company_slug: company.slug,
      count: leads.length,
    });

    metadata
      .set("company_slug", company.slug)
      .set("candidates", leads.length);

    if (leads.length === 0) {
      return {
        run_id: runId,
        company_id: companyId,
        candidates: 0,
        matched: 0,
        updated: 0,
        not_found_in_contacts: 0,
        no_phone_on_contact: 0,
        dry_run: dryRun,
      };
    }

    const apollo = createApolloClient();

    let matched = 0;
    let updated = 0;
    let notFound = 0;
    let noPhone = 0;

    for (const lead of leads) {
      const email = lead.email;
      try {
        const res = await apollo.searchContacts({
          qKeywords: email,
          perPage: 10,
          page: 1,
        });
        const contact = matchContactByEmail(res.contacts, email);
        if (!contact) {
          notFound += 1;
          logger.warn("contact not found", {
            lead_id: lead.id,
            email,
            returned: res.contacts.length,
          });
          continue;
        }
        matched += 1;

        const phone = pickBestPhone(contact);
        if (!phone) {
          noPhone += 1;
          logger.info("contact has no phone", {
            lead_id: lead.id,
            contact_id: contact.id,
          });
          continue;
        }

        logger.info("phone found", {
          lead_id: lead.id,
          contact_id: contact.id,
          phone_type: phone.phone_type,
          phone_status: phone.phone_status,
        });

        if (dryRun) continue;

        await updateLead(lead.id, {
          phone: phone.phone,
          phone_source: phone.phone_source,
          phone_type: phone.phone_type,
          phone_status: phone.phone_status,
          phone_revealed_at: new Date().toISOString(),
        });
        updated += 1;
      } catch (err) {
        logger.error("lookup failed", {
          lead_id: lead.id,
          email,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      await new Promise((r) => setTimeout(r, REQUEST_PACE_MS));
    }

    logger.info("backfill-apollo-phones done", {
      runId,
      matched,
      updated,
      noPhone,
      notFound,
    });

    return {
      run_id: runId,
      company_id: companyId,
      company_slug: company.slug,
      candidates: leads.length,
      matched,
      updated,
      no_phone_on_contact: noPhone,
      not_found_in_contacts: notFound,
      dry_run: dryRun,
    };
  },
});
