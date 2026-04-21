export { createScoutClient, type ScoutClient } from "./client.js";
export { buildScoutPrompt } from "./prompts.js";
export { researchRowFromScout } from "./research-mapper.js";
export {
  AgentApiSchemaError,
  scoutFitToTier,
  type AskResponse,
  type AskErrorBody,
  type ScoutPayload,
  type FitTag,
  type FitTier,
  type ResearchQuality,
} from "./types.js";
