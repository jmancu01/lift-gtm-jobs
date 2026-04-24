export { createScoutClient, type ScoutClient } from "./client.js";
export { buildScoutPrompt } from "./prompts.js";
export { researchRowFromScout } from "./research-mapper.js";
export {
  createOutreachClient,
  type OutreachClient,
} from "./outreach-client.js";
export {
  buildFirstDmLead,
  buildReplyLead,
  normalizeChatroom,
} from "./outreach-prompts.js";
export {
  AgentApiSchemaError,
  scoutFitToTier,
  type AskResponse,
  type AskErrorBody,
  type ScoutPayload,
  type FitTag,
  type FitTier,
  type ResearchQuality,
  type OutreachBatch,
  type OutreachLead,
  type FirstDmLead,
  type ReplyLead,
  type ConversationMessage,
  type OutreachReceipt,
  type OutreachResult,
  type FirstDmResult,
  type ReplyReadyResult,
  type ReplyHeldResult,
  type ReplyIntent,
  type OutreachResearch,
  type OutreachTone,
  type OutreachValueProp,
} from "./types.js";
