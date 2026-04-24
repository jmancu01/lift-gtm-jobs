import type {
  HeyReachChatMessage,
  HeyReachChatroom,
} from "../heyreach/index.js";
import type { Lead, ResearchSummary } from "../supabase/index.js";
import type {
  ConversationMessage,
  FirstDmLead,
  OutreachResearch,
  OutreachTone,
  OutreachValueProp,
  ReplyLead,
} from "./types.js";

const ALLOWED_TONES: readonly OutreachTone[] = [
  "formal",
  "conversational",
  "technical",
];

const ALLOWED_VALUE_PROPS: readonly OutreachValueProp[] = [
  "operational_efficiency",
  "post_ma_integration",
  "digital_transformation",
  "process_improvement",
];

function normaliseTone(tone: string | null): OutreachTone | null {
  if (!tone) return null;
  return (ALLOWED_TONES as readonly string[]).includes(tone)
    ? (tone as OutreachTone)
    : null;
}

function normaliseValueProp(vp: string | null): OutreachValueProp | null {
  if (!vp) return null;
  return (ALLOWED_VALUE_PROPS as readonly string[]).includes(vp)
    ? (vp as OutreachValueProp)
    : null;
}

function researchFromSummary(research: ResearchSummary): OutreachResearch {
  return {
    company_summary: research.company_summary,
    role_summary: research.role_summary,
    recent_news: research.recent_news,
    pain_points: research.pain_points ?? [],
    recommended_tone: normaliseTone(research.recommended_tone),
    recommended_value_prop: normaliseValueProp(research.recommended_value_prop),
  };
}

function fullName(lead: Lead): string {
  const parts = [lead.first_name, lead.last_name].filter(Boolean);
  return parts.join(" ").trim() || lead.email;
}

export function buildFirstDmLead(
  lead: Lead,
  research: ResearchSummary,
  connectionAcceptedAt: string,
): FirstDmLead {
  if (!research.personalized_linkedin_dm) {
    throw new Error(
      `buildFirstDmLead: personalized_linkedin_dm missing for lead ${lead.id}`,
    );
  }
  return {
    input_type: "first_dm",
    lead_id: lead.id,
    name: fullName(lead),
    title: lead.title,
    company: lead.company_name,
    linkedin_url: lead.linkedin_url,
    persona_type: lead.persona_type,
    icp_tier: lead.icp_tier,
    connection_accepted_at: connectionAcceptedAt,
    research: researchFromSummary(research),
    scout_copy: {
      linkedin_dm: research.personalized_linkedin_dm,
    },
  };
}

export function buildReplyLead(
  lead: Lead,
  research: ResearchSummary,
  chatroom: HeyReachChatroom,
  ourAccountId: number,
): ReplyLead {
  return {
    input_type: "reply",
    lead_id: lead.id,
    name: fullName(lead),
    title: lead.title,
    company: lead.company_name,
    linkedin_url: lead.linkedin_url,
    persona_type: lead.persona_type,
    icp_tier: lead.icp_tier,
    research: researchFromSummary(research),
    conversation: normalizeChatroom(chatroom, ourAccountId),
  };
}

/**
 * HeyReach chat messages expose `sender` as an unknown blob (doc §12 flags
 * the shape as not fully pinned down). We match against ourAccountId across
 * the shapes we've observed: primitive number/string, or an object carrying
 * an `id` / `accountId` / `linkedInAccountId` field. Anything else is "them".
 */
function isUs(message: HeyReachChatMessage, ourAccountId: number): boolean {
  const sender = message.sender;
  if (sender == null) return false;

  if (typeof sender === "number") return sender === ourAccountId;
  if (typeof sender === "string") return sender === String(ourAccountId);

  if (typeof sender === "object") {
    const record = sender as Record<string, unknown>;
    for (const key of ["id", "accountId", "linkedInAccountId"]) {
      const v = record[key];
      if (typeof v === "number" && v === ourAccountId) return true;
      if (typeof v === "string" && v === String(ourAccountId)) return true;
    }
  }
  return false;
}

export function normalizeChatroom(
  chatroom: HeyReachChatroom,
  ourAccountId: number,
): ConversationMessage[] {
  const messages = chatroom.messages ?? [];
  return messages
    .filter((m) => typeof m.body === "string" && m.body.trim().length > 0)
    .map<ConversationMessage>((m) => ({
      from: isUs(m, ourAccountId) ? "us" : "them",
      text: m.body as string,
      at: m.createdAt,
    }))
    .sort((a, b) => {
      const ta = Date.parse(a.at);
      const tb = Date.parse(b.at);
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    });
}
