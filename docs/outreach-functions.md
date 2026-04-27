# Outreach Functions — Build Plan

> Companion to `agentapi/agents/outreach-orchestrator/PLAN.md`. This doc covers the `gtm-jobs` side: the Trigger.dev task that calls the outreach-orchestrator agent, the AgentAPI client, the HeyReach I/O on either side, and the schema changes this flow needs.

## Status (2026-04-27)

| § | Item | Status |
|---|------|--------|
| 4 | Migration (`20260424140000_add_outreach_tables.sql`) | **Done** — applied to project `ycwarkyijoeunmgjbikm` |
| 4b | `lead_events.payload JSONB` added out-of-band (not in the outreach migration) | **Done** — column exists; 2/3,843 heyreach rows populated so far (1× `connection_request_accepted`, 1× `every_message_reply_received`) |
| 5 | AgentAPI outreach client (`outreach-client.ts`, `outreach-prompts.ts`, union types) | **Done** |
| 6 | Trigger tasks (`outreach-dispatch/index.ts`, `enroll-cold.ts`, `compose-and-send.ts`, `buckets.ts`) | **Done (uncommitted)** — registered; `enroll-cold` `heyreach_lead_id` backfill via `getLeadsFromCampaign` implemented + `HeyReachCampaignLead` type added. Cron defined on the task but not yet attached in the Trigger.dev dashboard (step 7). |
| 10.2 | Make.com upgrade (write full webhook body to `lead_events.payload`; populate `leads.heyreach_lead_id` / `heyreach_conversation_id` / `replied_at`) | **In progress** — `connection_request_accepted` and `every_message_reply_received` payloads both captured; conversation-id path resolved (`payload.conversation_id` top-level). Make scenario still needs to update the `leads` table on every event going forward. |
| 10.3 | Per-company config (`heyreach_linkedin_account_id`, `heyreach_conn_req_campaigns`) | **Not done** — template at `docs/outreach-pilot-config.sql` |
| 10.4 | `normalizeChatroom` unit test | **Done** — synthetic fixture at `src/lib/agentapi/outreach-prompts.test.ts`; TODO to swap for a captured payload |
| 10.6 | Smoke test (hand-pick one first_dm + one reply lead) | **Not done** |
| 10.7 | Enable cron | **Not done** |

Deviations from the spec below captured during implementation:
- §5 timeout is `180_000ms` (not `120_000ms`) — 4× the 45s per-batch budget gives slow chunks room to fail before the Trigger.dev task ceiling.
- HeyReach client method is `addLeadsToCampaign` (already hits the `/AddLeadsToCampaignV2` endpoint internally); plan text said `addLeadsToCampaignV2`.
- Cold bucket additionally skips leads without `linkedin_url` (HeyReach requires `profileUrl`).
- `normalizeChatroom` matches `sender` against `ourAccountId` across number / string / `{id|accountId|linkedInAccountId}` shapes — `payload.sender.id` (number) is now confirmed against the captured `connection_request_accepted` and `every_message_reply_received` rows.
- §6 typing fix landed as a new `HeyReachCampaignLead` type wrapping the existing `HeyReachLead` (with `id: number`, `linkedInUserProfile`, `creationTime`, etc.) rather than mutating `HeyReachLead`. `getLeadsFromCampaign` now returns `HeyReachPaginatedResponse<HeyReachCampaignLead>` and the enroll-cold backfill matches on `linkedInUserProfile.profileUrl`.


- Agent contract: `agentapi/agents/outreach-orchestrator/PLAN.md` (§4 input, §5 output). Agent has no tools, no DB access, no HeyReach access — it is a pure function `batch → receipt`.
- AgentAPI port (dev): `3288`. Single instance, **serializes `/message` calls** — never fire two concurrent POSTs.
- Webhook ingress stays on **Make.com** (Path 1). This repo does not own a webhook endpoint in V1.

---

## 1. TL;DR

- `gtm-jobs` adds one cron `outreach-dispatch` (every 30 min, per active company during working hours) that buckets eligible leads into three flows: **cold** (enroll), **first_dm** (compose+send), **reply** (compose+send or Slack).
- Only the `first_dm` and `reply` buckets call the agent. The cold bucket is a direct HeyReach `add_leads_to_campaign_v2` — no agent involvement.
- A new thin AgentAPI client (`createOutreachClient`) mirrors `createScoutClient`. One method: `compose(batch) → OutreachReceipt`.
- Make.com is upgraded to persist HeyReach IDs (`heyreach_lead_id`, `heyreach_conversation_id`) into Supabase on webhook fire; without those IDs we can't call `sendMessage` or `getChatroom`, so leads that predate the Make.com upgrade are silently skipped (no backfill).
- `lead_events` remains the authoritative signal log. No new "outreach queue" flag on `leads`.

---

## 2. Responsibility split

### `gtm-jobs` owns (this doc)

- Cron scheduling, per-company fan-out, bucketing leads.
- All HeyReach I/O for this flow: `add_leads_to_campaign_v2` (cold), `get_chatroom` (reply), `send_message` (ready_to_send).
- Building the agent input batch (pre-seeding research, scout copy, normalized conversation).
- Calling AgentAPI `POST /message`.
- Parsing receipt; executing sends; writing `lead_messages`, `lead_events`; advancing `funnel_stage`.
- Slack handoff for `held_for_human`.

### The agent owns

- Per-lead LinkedIn copy composition (chill-touch for `first_dm`; on-tone reply for `reply`).
- Reply intent classification; hold decisions.
- Receipt JSON emission. No side effects.

### Make.com owns

- Receiving HeyReach webhooks.
- Writing `lead_events` rows with the **full HeyReach webhook body stored in `lead_events.payload` (JSONB)**. `detail` is free to use for auxiliary trace info (e.g. Make scenario run URL) — do NOT stuff the payload into `detail`.
- Setting `leads.heyreach_lead_id` (from `payload.lead.id`) and `leads.heyreach_conversation_id` (from reply/message payloads) when first observable.
- Updating `leads.replied_at` on reply events (from `payload.timestamp`).

---

## 3. Architecture

```
HeyReach webhooks
    │
    ▼
Make.com scenario  ──► Supabase
    • insert lead_events (payload = full HeyReach webhook body, JSONB)
    • update leads.heyreach_lead_id / heyreach_conversation_id / replied_at

          
cron: */30 * * * *  ──► outreach-dispatch (per active company)
    │                                │
    │     buckets                    │
    │   ┌───────────┐ cold leads     │
    │   │  enroll   │ ─► HeyReach add_leads_to_campaign_v2
    │   └───────────┘                │  (no agent)
    │   ┌───────────┐                │
    │   │first_dm +  │ ─► compose-and-send
    │   │  reply    │       │        │
    │   └───────────┘       │        │
    │                       │        │
    │                       ▼        │
    │         build OutreachBatch    │
    │         (fetch get_chatroom    │
    │          for reply leads,      │
    │          normalize thread)     │
    │                       │        │
    │                       ▼        │
    │         AgentAPI :3288 POST /message
    │                       │        │
    │                       ▼        │
    │         per result:            │
    │          ready_to_send →       │
    │            HeyReach send_message
    │            + lead_messages ins │
    │            + lead_events ins   │
    │            + funnel_stage++    │
    │          held_for_human →      │
    │            Slack post          │
    │            + lead_events ins   │
    └──────────────────────────────────┘
```

---

## 4. Schema changes

Apply as one migration via `mcp__supabase__apply_migration`:

```sql
ALTER TABLE companies
  ADD COLUMN heyreach_conn_req_campaigns JSONB,
  ADD COLUMN heyreach_linkedin_account_id BIGINT;

ALTER TABLE leads
  ADD COLUMN heyreach_lead_id TEXT,
  ADD COLUMN heyreach_conversation_id TEXT;

CREATE TABLE lead_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,                 -- 'linkedin' | 'email' | 'phone'
  direction TEXT NOT NULL,               -- 'outbound' | 'inbound'
  content TEXT NOT NULL,
  source_system TEXT NOT NULL,           -- 'heyreach' | 'instantly' | 'agent'
  external_message_id TEXT,              -- HeyReach message ID if returned
  batch_id TEXT,                         -- joins to heartbeat_runs
  input_type TEXT,                       -- 'first_dm' | 'reply'
  copy_source TEXT,                      -- 'scout_passthrough' | 'override' | null
  intent TEXT,                           -- reply only
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lead_messages_lead_idx ON lead_messages (lead_id, created_at DESC);
```

Column meanings:
- `companies.heyreach_conn_req_campaigns`: `{"<persona_name>": "<heyreach_campaign_id>"}`. Used only by cold enrollment. **These campaigns must be connection-only — no message sequence attached.** First DMs are composed by the outreach-orchestrator and sent via `sendMessage` after `connection_request_accepted` fires; any campaign that also queues a sequence step will race our flow and step on our first DM. Reconfigure before wiring a campaign ID in here.
- `companies.heyreach_linkedin_account_id`: our sender account ID for that company. Required by `sendMessage` and `getChatroom`. Matches `payload.sender.id` on every HeyReach webhook event we send.
- `leads.heyreach_lead_id`: populated by Make.com on `connection_request_accepted` from `payload.lead.id` (HeyReach stringifies it, e.g. `"835630791"`).
- `leads.heyreach_conversation_id`: populated by Make.com on the first reply/send event for the lead (not present on `connection_request_accepted`).

### 4a. `lead_events.payload` (added out-of-band)

`lead_events.payload JSONB NULL` was added by the user directly (not via the outreach migration) so Make.com can store the full HeyReach webhook body per event. The column is **JSONB**, so Make should insert it as an object, not a stringified JSON. A reference row is `85e1a691-f80d-485d-8feb-cfd000db3259` (a `connection_request_accepted` for Frank Anello at Citi). The observed top-level shape for that event type:

```json
{
  "connection_message": "",
  "campaign":   { "id": 329500, "name": "camp_linkedin_transformation", "status": 1 },
  "sender":     { "id": 153472, "first_name": "...", "last_name": "...", "email_address": "...", "profile_url": "..." },
  "lead": {
    "id":             "835630791",
    "profile_url":    "https://www.linkedin.com/in/...",
    "first_name":     "...", "last_name": "...", "full_name": "...",
    "location":       "...",
    "summary":        "...",
    "company_name":   "Citi",
    "position":       "SVP - Head of Transformation Risk Appetite & Limits",
    "email_address":  "frank.a@citigroup.com",
    "enriched_email": null, "custom_email": "...",
    "tags": [], "lists": [{ "id": 520383, "name": "transformation_list", "custom_fields": {} }]
  },
  "timestamp":      "2026-04-24T11:39:21.9648884Z",
  "event_type":     "connection_request_accepted",
  "correlation_id": "374ffa11-682e-4666-b2f5-52d30218dc30"
}
```

For `every_message_reply_received` (reference row `lead_events.id = 601ca7d0-4d43-4a4e-9bbb-20473934e2b2`, captured 2026-04-27) the chatroom id is at **`payload.conversation_id`** (top-level, base64 string starting `2-...`), and the recent reply text is in `payload.recent_messages[*]` (`{creation_time, message, is_reply}`). The other reply/message event types (`message_sent`, `message_reply_received`, `message_replied`) are presumed to share this shape but are still uncaptured — verify each as it lands before relying on the path.

---

## 5. AgentAPI client

Mirror `src/lib/agentapi/client.ts` (scout).

### `src/lib/agentapi/outreach-client.ts`

```ts
export interface OutreachClient {
  compose(batch: OutreachBatch): Promise<OutreachReceipt>;
}

export function createOutreachClient(): OutreachClient;
```

- POST `${AGENTAPI_BASE_URL}/outreach-orchestrator/message`. The `outreach-orchestrator` prefix matches the `--agent-id` flag in `agentapi/Makefile` and the AgentAPI gateway's routing convention (scout client uses the same pattern: `${BASE_URL}/scout/ask`).
- Body: `{ prompt: serializedBatch, schema: "outreach.v1", batch_id }`.
- `prompt` is `batch_id:<id>\n<json>` per PLAN §11 (heartbeat_runs join).
- Timeout: `DEFAULT_TIMEOUT_MS = 120_000` (no web research, budget §8 says <45s per batch of 10).
- 400 → `AgentApiSchemaError` (same shape as scout).
- Returns validated `OutreachReceipt` (Zod parse, not just cast).

### Research source: `research_summaries`, not `lead_ai_research`

The agent PLAN §4 expects `research: {company_summary, role_summary, recent_news, pain_points, recommended_tone, recommended_value_prop}` and `scout_copy: {linkedin_dm}`. These fields already exist on **`research_summaries`** (the table scout's prompt writes into directly via Postgres MCP) — specifically `role_summary`, `recent_news`, `pain_points`, `recommended_tone`, `recommended_value_prop`, and `personalized_linkedin_dm`.

`lead_ai_research` (the gtm-jobs-side mirror) has a narrower shape and is NOT what we read for outreach. We leave `lead_ai_research` writes untouched; outreach reads from `research_summaries` joined by `lead_id`.

Mapping to agent input:

| Agent input field | Source column |
|---|---|
| `research.company_summary` | `research_summaries.company_summary` |
| `research.role_summary` | `research_summaries.role_summary` |
| `research.recent_news` | `research_summaries.recent_news` |
| `research.pain_points` | `research_summaries.pain_points` |
| `research.recommended_tone` | `research_summaries.recommended_tone` |
| `research.recommended_value_prop` | `research_summaries.recommended_value_prop` |
| `scout_copy.linkedin_dm` (first_dm only) | `research_summaries.personalized_linkedin_dm` |

A lead is only eligible for `first_dm`/`reply` if a `research_summaries` row exists and `personalized_linkedin_dm IS NOT NULL` (for `first_dm`). Otherwise skip; the cron picks it up once scout backfills.

### `src/lib/agentapi/outreach-prompts.ts`

```ts
export interface ResearchSummary {  // row shape from research_summaries
  lead_id: string;
  company_summary: string | null;
  role_summary: string | null;
  recent_news: string | null;
  pain_points: string[] | null;
  recommended_tone: "formal" | "conversational" | "technical" | null;
  recommended_value_prop:
    | "operational_efficiency"
    | "post_ma_integration"
    | "digital_transformation"
    | "process_improvement"
    | null;
  personalized_linkedin_dm: string | null;
}

export function buildFirstDmLead(
  lead: Lead,
  research: ResearchSummary,
  connectionAcceptedAt: string  // ISO8601 from lead_events
): FirstDmLead;

export function buildReplyLead(
  lead: Lead,
  research: ResearchSummary,
  chatroom: HeyReachChatroom,
  ourAccountId: number
): ReplyLead;

export function normalizeChatroom(
  chatroom: HeyReachChatroom,
  ourAccountId: number
): ConversationMessage[];
```

`normalizeChatroom` filters `chatroom.messages`, maps each to `{ from: "us" | "them", text, at }` based on whether the message's sender matches `ourAccountId`. Sorted chronologically.

`buildFirstDmLead` pulls `scout_copy.linkedin_dm` from `research.personalized_linkedin_dm` (enforced non-null by the bucket query).

### `src/lib/agentapi/types.ts` (extensions)

Union types matching PLAN §4/§5:

- `FirstDmLead` with `input_type: "first_dm"`, required `research`, `scout_copy`.
- `ReplyLead` with `input_type: "reply"`, required `research`, `conversation[]`.
- `OutreachBatch = { batch_id, as_of, leads: (FirstDmLead | ReplyLead)[] }`.
- `OutreachResult`:
  - `FirstDmResult`: `{ lead_id, input_type:"first_dm", status:"ready_to_send", copy_source, message, reasoning }`.
  - `ReplyResult` ready: `{ lead_id, input_type:"reply", status:"ready_to_send", intent, conversation_summary, message, reasoning }`.
  - `ReplyResult` held: `{ lead_id, input_type:"reply", status:"held_for_human", intent, conversation_summary, hold_reason, suggested_draft }`.
- `OutreachReceipt = { batch_id, results: OutreachResult[] }`.

---

## 6. Trigger tasks

All under `src/trigger/outreach-dispatch/`.

### `index.ts` — parent cron

```ts
export const outreachDispatch = schedules.task({
  id: "outreach-dispatch",
  // Mon–Fri, 09:00–18:59, every 30 min. Cron expression is UTC by default
  // in Trigger.dev; override via `timezone: "America/New_York"` if needed.
  cron: { pattern: "*/30 9-18 * * 1-5", timezone: "America/New_York" },
  maxDuration: 1_800,
  run: async () => {
    // 1. list active companies with heyreach_linkedin_account_id IS NOT NULL
    // 2. for each: bucket leads (cold / first_dm / reply)
    // 3. fan out: enrollCold.batchTrigger + composeAndSend.batchTrigger
  }
});
```

Bucket queries (per company, ordered by oldest signal first, hard cap ~100 leads per bucket per run). All three buckets join `research_summaries` where relevant — skip any lead whose research row is missing.

- **Cold** — `funnel_stage='qualified' AND heyreach_lead_id IS NULL AND persona_type IN (keys of heyreach_conn_req_campaigns) AND qualification_status='ready'` (no research required — cold enrollment does not compose copy).
- **First-DM** — leads with a `connection_request_accepted` event (inner join `lead_events`, surface `connection_request_accepted.created_at AS connection_accepted_at`) AND no outbound `lead_messages` row AND `heyreach_conversation_id IS NOT NULL` AND `research_summaries.personalized_linkedin_dm IS NOT NULL`. The `connection_accepted_at` value flows straight into `buildFirstDmLead`.
- **Reply** — leads where `max(lead_events.created_at) WHERE event_type IN ('message_reply_received','message_replied','every_message_reply_received') > COALESCE(max(lead_messages.created_at) WHERE direction='outbound', '-infinity')` AND `heyreach_conversation_id IS NOT NULL` AND a `research_summaries` row exists (no `personalized_linkedin_dm` requirement — replies don't need a scout draft).

### `enroll-cold.ts`

- Input: `{ companyId, leadIds: string[] }`.
- Looks up `companies.heyreach_conn_req_campaigns`. Groups leads by `persona_type`. For each persona, calls `heyReachClient.addLeadsToCampaign(campaignId, leads)` (method name per client.ts:143; hits `/AddLeadsToCampaignV2` internally).
- On success: update `leads.funnel_stage='enrolled'`, `leads.enrolled_at=now()`, `leads.heyreach_campaign=<persona_name>`. Insert `lead_events` (`event_type='connection_request_enrolled'`, `source_system='gtm-jobs'`).
- **Backfill `heyreach_lead_id` (primary path):** `addLeadsToCampaign` returns only counts (`addedLeadsCount`, etc.), so immediately after a successful enroll, the task calls `heyReachClient.getLeadsFromCampaign({ campaignId, limit: 100, timeFilter: "CreationTime", timeFrom: <run_start_iso> })` and updates `leads.heyreach_lead_id` where `heyreach_lead_id IS NULL` matching on `linkedInUserProfile.profileUrl`. The HeyReach campaign id is a numeric `id` (stringified before write to keep the column TEXT). This removes the dependency on Make.com catching `connection_request_accepted` to populate the ID. Make.com remains a redundant fallback (idempotent — "only overwrite when NULL" guardrail in §10.2 prevents double-writes).
  - Type: response items are `HeyReachCampaignLead` (`{ id: number, linkedInUserProfile: HeyReachLead, creationTime, leadCampaignStatus, ... }`), distinct from `HeyReachLead` itself.
  - `heyreach_conversation_id` **cannot** be captured at enroll time — the chatroom doesn't exist until connection acceptance or first message. That ID stays on the Make.com path (`payload.conversation_id` on reply/message events).
- Failures → log + retry policy per Trigger defaults. No agent involvement.

### `compose-and-send.ts`

Single child task handling mixed `first_dm` + `reply` batches. **Queue concurrency: 1** (serializes POSTs to :3288).

```ts
export const composeAndSend = schemaTask({
  id: "compose-and-send",
  queue: { name: "outreach-agent", concurrencyLimit: 1 },
  schema: z.object({
    companyId: z.string().uuid(),
    firstDmLeadIds: z.array(z.string().uuid()),
    replyLeadIds: z.array(z.string().uuid()),
  }),
  run: async ({ companyId, firstDmLeadIds, replyLeadIds }) => {
    // 1. Load Lead + ResearchSummary (from research_summaries, NOT lead_ai_research) for all IDs.
    //    For firstDmLeadIds also join lead_events to surface connection_accepted_at.
    // 2. For each replyLead: HeyReach getChatroom(accountId, conversationId) → normalizeChatroom.
    // 3. Build OutreachBatch. Chunk at 10 leads per POST.
    // 4. For each chunk: await outreachClient.compose(chunk).
    //    - On AgentApiSchemaError: retry once. If still bad → treat every lead
    //      in the chunk as held_for_human (suggested_draft="", hold_reason="agent returned unparseable output").
    // 5. For each result:
    //    - ready_to_send → HeyReach sendMessage → insert lead_messages (outbound, content=message)
    //                     → insert lead_events(event_type='outreach_message_sent', source_system='agent',
    //                        detail={batch_id, input_type, copy_source})
    //                     → advance funnel_stage (first_dm: qualified|enrolled → contacted; reply: no change)
    //    - held_for_human → Slack post (suggested_draft + hold_reason + conversation_summary)
    //                     → insert lead_events(event_type='outreach_held_for_human', source_system='agent',
    //                        detail={intent, hold_reason, suggested_draft, batch_id})
    //                     → do NOT write lead_messages (nothing sent)
  }
});
```

---

## 7. Batching, concurrency, cost

- Per PLAN §8: batch of 10 ≈ <45s wall-clock, <$0.25 total.
- `compose-and-send` queue `concurrencyLimit: 1` is **required** — two concurrent POSTs deadlock the agent.
- Within a batch, the agent processes leads serially and shares prompt cache — smaller batches are more expensive per lead.
- Cron tick caps: ≤100 leads per bucket per company per run. Leftovers wait for the next 30-min tick.

### Error handling

- HeyReach `sendMessage` fails → log, leave row absent from `lead_messages` (so next cron tick retries that lead). Don't insert the `lead_events` success row.
- HeyReach `getChatroom` fails for a reply lead → drop that lead from this batch (will retry next tick). Don't block the batch.
- AgentAPI `AgentApiSchemaError` → retry once. On second failure → blanket Slack for the whole chunk.
- AgentAPI network timeout → treat as retryable at Trigger.dev task level (standard retry policy).

---

## 8. Observability

- `batch_id` convention: `${ISO8601}/${companyId}/${taskRunId}`.
- First line of every POST body: `batch_id:<id>` (§11 of agent PLAN) — joins `heartbeat_runs` to Trigger.dev runs.
- `lead_messages.batch_id` and `lead_events.detail.batch_id` → full audit chain from Trigger run → heartbeat run → per-lead message.
- Metadata on `outreachDispatch`: `total_companies`, `total_cold`, `total_first_dm`, `total_reply`, `total_sent`, `total_held`.
- Cost alert: daily sum `heartbeat_runs.cost_usd` filtered to `agent_id='outreach-orchestrator'`. Start threshold $3/day per PLAN §11.

---

## 9. Environment variables

New:
- `AGENTAPI_BASE_URL` (already exists for scout; reuse — outreach hits same host, different path).
- `AGENTAPI_AUTH_TOKEN` (already exists).
- `SLACK_OUTREACH_HOLD_WEBHOOK_URL` — where held_for_human posts go.

Not needed:
- No `HEYREACH_WEBHOOK_SECRET` here (Make.com owns webhook ingress).
- No extra HeyReach creds (existing `HEYREACH_API_KEY` + client).

---

## 10. Rollout

1. **Migration** — [x] DDL from §4 applied via `mcp__supabase__apply_migration` as `add_outreach_tables`. `src/lib/supabase/types.ts` extended with new `Lead` / `Company` columns, `LeadMessage`, and `ResearchSummary` interfaces; helpers in `src/lib/supabase/messages.ts`.
2. **Make.com upgrade** — [~] Scenario must write the full HeyReach webhook body to **`lead_events.payload` (JSONB)** and populate `leads.heyreach_conversation_id` (primary path — the chatroom doesn't exist at enroll time, so only the webhook can source this) and `replied_at` on replies. `leads.heyreach_lead_id` is now populated primarily by `enroll-cold`'s backfill (§6); Make.com's write is a redundant fallback for leads enrolled outside our cron (manual enrollment, imports) — the "only overwrite when NULL" guardrail keeps both paths idempotent. `detail` is NOT for the payload — leave it free for trace info (e.g. Make run URL). Verify by inspecting a few new event rows per event-type before enabling the cron — until Make.com runs, replies will be silently filtered out of the reply bucket.

   **Status check (2026-04-27):** 2 events have `payload` populated — `85e1a691-f80d-485d-8feb-cfd000db3259` (`connection_request_accepted`, captured 2026-04-24) and `601ca7d0-4d43-4a4e-9bbb-20473934e2b2` (`every_message_reply_received`, captured 2026-04-27 via manual SQL insert). The other 3,841 heyreach events predate this column and cannot be backfilled. The Kristin Hendrix lead (`f7ef879f-46e3-46ae-99ff-7bf34cc27c0d`) is the first row with `heyreach_lead_id` and `heyreach_conversation_id` populated — that backfill was done by the manual insert, not by Make. The Make scenario still needs to start writing the `leads` table on every event going forward.

   **Per-event-type field map (source of truth: `payload.*` fields).** Match the lead row by `payload.lead.profile_url = leads.linkedin_url` (fallback: `payload.lead.email_address = leads.email`).

   | HeyReach `event_type` | `leads.heyreach_lead_id` | `leads.heyreach_conversation_id` | `leads.replied_at` |
   |---|---|---|---|
   | `connection_request_accepted` | set from `payload.lead.id` if NULL | — (not in payload) | — |
   | `message_sent` | set from `payload.lead.id` if NULL | set from `payload.conversation_id` if NULL (presumed — unverified) | — |
   | `message_reply_received` / `every_message_reply_received` / `message_replied` | set from `payload.lead.id` if NULL | set from `payload.conversation_id` if NULL (verified for `every_message_reply_received`) | set to `payload.timestamp` (overwrite with latest) |
   | all others (`viewed_profile`, `connection_request_sent`, `email_opened`, `email_bounced`, `link_clicked`, `campaign_completed_for_lead_without_reply`) | best-effort set from `payload.lead.id` if NULL | — | — |

   **Write pattern for every row** (independent of event type):
   ```
   INSERT INTO lead_events (lead_id, event_type, source_system, channel,
                            campaign_name, workflow, email, payload, detail, created_at)
   VALUES (<matched lead_id>,
           <payload.event_type>,
           'heyreach',
           'linkedin',                                  -- or 'email' for email_* events
           <payload.campaign.name>,
           <Make scenario / workflow id, e.g. 'WF-6'>,
           <payload.lead.email_address>,
           <full payload, as JSONB object — NOT stringified>,
           <Make scenario log URL as a JSONB string, optional>,
           <payload.timestamp>);
   ```

   **Guardrails:**
   - Only overwrite `leads.heyreach_lead_id` / `heyreach_conversation_id` when the target column is NULL — never replace with a different non-null id.
   - Insert `payload` as a JSONB object, not a JSON-encoded string (the reference row stores it correctly; don't regress).
   - Conversation-id field name is now resolved (`payload.conversation_id`, top-level) via the captured `every_message_reply_received` payload. Capture an additional `message_sent` or `message_reply_received` payload to confirm the same path holds for those event types before flipping the cron on.
3. **Per-company config** — [ ] Set `companies.heyreach_linkedin_account_id` and `companies.heyreach_conn_req_campaigns` for the pilot company (LIFT). Template SQL at `docs/outreach-pilot-config.sql` — fill in the account ID + persona→campaign map, then run. Without `heyreach_linkedin_account_id` a company is skipped entirely by `outreach-dispatch`.
4. **AgentAPI client** — [x] `outreach-client.ts`, `outreach-prompts.ts`, union types added. Zod-validates receipts (discriminated union on `status`). `normalizeChatroom` has unit coverage at `src/lib/agentapi/outreach-prompts.test.ts` (`npm test`) over a synthetic chatroom fixture — swap for a captured HeyReach payload once observed (see TODO in the test).
5. **Trigger tasks** — [x] `outreach-dispatch` (schedule), `enroll-cold`, `compose-and-send`, `buckets.ts` all in `src/trigger/outreach-dispatch/`. Cron defined on the task but **not yet attached in the Trigger.dev dashboard** — deployment is effectively paused until someone flips it on (step 7).
6. **Smoke test** — [ ] Manually trigger `compose-and-send` with one `first_dm` lead and one `reply` lead (hand-picked; agent already running on :3288). Confirm: HeyReach DM arrives, `lead_messages` row written, `lead_events` row written, `funnel_stage` advanced.
7. **Enable cron** — [ ] Attach the schedule in the Trigger.dev dashboard. Watch the first tick, then let it run.

---

## 11. Explicitly out of V1

- No webhook endpoint in this repo (Path 1 keeps Make.com).
- No backfill script. Leads without `heyreach_conversation_id` / `heyreach_lead_id` sit out until the next HeyReach webhook populates them via Make.com.
- No lead-level "outreach_pending" flag — `lead_events` is the signal.
- No email / phone composition. Agent's `scout_copy.email` path (if scout produces one) is ignored.
- No multi-touch cadence, no follow-up scheduling. One first-DM, then replies only.
- No retry scheduling for held_for_human after human action — that's a future workflow.

---

## 12. Open questions

- **Make.com payload shape — sender identity.** ✅ **Resolved.** HeyReach webhook bodies include `payload.sender.id` (integer, e.g. `153472`). That's the stable marker — it matches `companies.heyreach_linkedin_account_id` 1:1 and is what both Make and `normalizeChatroom` key off to decide `from: "us" | "them"`. Reference row: `lead_events.id = 85e1a691-f80d-485d-8feb-cfd000db3259`.
- **Make.com payload shape — conversation id.** ✅ **Resolved (2026-04-27).** Reply events expose the chatroom id at top-level `payload.conversation_id` (base64 string starting `2-...`). Reference row: `lead_events.id = 601ca7d0-4d43-4a4e-9bbb-20473934e2b2` (`every_message_reply_received`, conversation `2-YjBmMTRkNTUtOGQ4Yi00YThhLTgwZDMtNTU4ZmZjYTc0MTk0XzEwMA==`). Same path is presumed (but not yet captured) for `message_sent`, `message_reply_received`, and `message_replied`; verify each as it lands. `connection_request_accepted` continues to not carry a conversation id — that's expected (chatroom doesn't exist yet).
- **Persona → campaign mapping maintenance.** Manual for V1 (direct SQL on `companies.heyreach_conn_req_campaigns`). If personas churn often, move to a proper join table.
- **Scout copy for replies.** Scout only produces cold openers. Replies have no `scout_copy`. Confirmed with agent PLAN §4 note: "`scout_copy.linkedin_dm` is present for `first_dm`, absent for `reply`."
- **Funnel stage on reply.** Currently the cron does not advance stage on reply send (no clean target — the lead is already past `contacted`). Revisit if downstream cares.
- **Working hours timezone**. Doc pins cron to `America/New_York` in §6. Change if the team operates on a different schedule.
- **Gateway path confirmation.** §5 assumes `${AGENTAPI_BASE_URL}/outreach-orchestrator/message` (agent-id prefix, matching scout's `${BASE_URL}/scout/ask`). Verify against the AgentAPI gateway's actual routing config before flipping cron on in §10 step 7.
