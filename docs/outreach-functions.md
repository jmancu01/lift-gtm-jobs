# Outreach Functions — Build Plan

> Companion to `agentapi/agents/outreach-orchestrator/PLAN.md`. This doc covers the `gtm-jobs` side: the Trigger.dev task that calls the outreach-orchestrator agent, the AgentAPI client, the HeyReach I/O on either side, and the schema changes this flow needs.

- Agent contract: `agentapi/agents/outreach-orchestrator/PLAN.md` (§4 input, §5 output). Agent has no tools, no DB access, no HeyReach access — it is a pure function `batch → receipt`.
- AgentAPI port (dev): `3288`. Single instance, **serializes `/message` calls** — never fire two concurrent POSTs.
- Webhook ingress stays on **Make.com** (Path 1). This repo does not own a webhook endpoint in V1.

---

## 1. TL;DR

- `gtm-jobs` adds one cron `outreach-dispatch` (every 30 min, per active company) that buckets eligible leads into three flows: **cold** (enroll), **first_dm** (compose+send), **reply** (compose+send or Slack).
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
- Writing rich `lead_events` rows (full HeyReach payload in `detail`).
- Setting `leads.heyreach_lead_id` and `leads.heyreach_conversation_id` when first observable in the payload.
- Updating `leads.replied_at` on reply events.

---

## 3. Architecture

```
HeyReach webhooks
    │
    ▼
Make.com scenario  ──► Supabase
    • insert lead_events (detail = full payload)
    • update leads.heyreach_lead_id / heyreach_conversation_id / replied_at

                                     ┌──────────────────────────────────┐
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
- `companies.heyreach_conn_req_campaigns`: `{"<persona_name>": "<heyreach_campaign_id>"}`. Used only by cold enrollment.
- `companies.heyreach_linkedin_account_id`: our sender account ID for that company. Required by `sendMessage` and `getChatroom`.
- `leads.heyreach_lead_id`: populated by Make.com on `connection_request_accepted`.
- `leads.heyreach_conversation_id`: populated by Make.com on first reply/send event for the lead.

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

- POST `${AGENTAPI_BASE_URL}/outreach/message`.
- Body: `{ prompt: serializedBatch, schema: "outreach.v1", batch_id }`.
- `prompt` is `batch_id:<id>\n<json>` per PLAN §11 (heartbeat_runs join).
- Timeout: `DEFAULT_TIMEOUT_MS = 120_000` (no web research, budget §8 says <45s per batch of 10).
- 400 → `AgentApiSchemaError` (same shape as scout).
- Returns validated `OutreachReceipt` (Zod parse, not just cast).

### `src/lib/agentapi/outreach-prompts.ts`

```ts
export function buildFirstDmLead(
  lead: Lead,
  research: LeadAiResearch,
  scoutCopy: { linkedin_dm: string }
): FirstDmLead;

export function buildReplyLead(
  lead: Lead,
  research: LeadAiResearch,
  chatroom: HeyReachChatroom,
  ourAccountId: number
): ReplyLead;

export function normalizeChatroom(
  chatroom: HeyReachChatroom,
  ourAccountId: number
): ConversationMessage[];
```

`normalizeChatroom` filters `chatroom.messages`, maps each to `{ from: "us" | "them", text, at }` based on whether the message's sender matches `ourAccountId`. Sorted chronologically.

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
  cron: "*/30 * * * *",
  maxDuration: 1_800,
  run: async () => {
    // 1. list active companies with heyreach_linkedin_account_id IS NOT NULL
    // 2. for each: bucket leads (cold / first_dm / reply)
    // 3. fan out: enrollCold.batchTrigger + composeAndSend.batchTrigger
  }
});
```

Bucket queries (per company, ordered by oldest signal first, hard cap ~100 leads per bucket per run):

- **Cold** — `funnel_stage='qualified' AND heyreach_lead_id IS NULL AND persona_type IN (keys of heyreach_conn_req_campaigns) AND qualification_status='ready'`
- **First-DM** — leads with a `connection_request_accepted` event AND no outbound `lead_messages` row AND `heyreach_conversation_id IS NOT NULL`. (If conversation_id is null the reply path can't call `sendMessage` anyway — Make.com upgrade must populate it on `connection_request_accepted` or we fall through to the cron after the first reply.)
- **Reply** — `max(lead_events.created_at) WHERE event_type IN ('message_reply_received','message_replied','every_message_reply_received') > COALESCE(max(lead_messages.created_at) WHERE direction='outbound'), '-infinity')`

### `enroll-cold.ts`

- Input: `{ companyId, leadIds: string[] }`.
- Looks up `companies.heyreach_conn_req_campaigns`. Groups leads by `persona_type`. For each persona, calls `heyReachClient.addLeadsToCampaignV2(campaignId, leads)`.
- On success: update `leads.funnel_stage='enrolled'`, `leads.enrolled_at=now()`, `leads.heyreach_campaign=<persona_name>`. Insert `lead_events` (`event_type='connection_request_enrolled'`, `source_system='gtm-jobs'`).
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
    // 1. Load Lead + LeadAiResearch for all IDs.
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

1. **Migration** — apply the DDL in §4 via `mcp__supabase__apply_migration`. Update `src/lib/supabase/types.ts` to include new columns on `Lead` / `Company` and a new `LeadMessage` interface.
2. **Make.com upgrade** — scenario writes rich `lead_events.detail` and populates `leads.heyreach_lead_id` + `heyreach_conversation_id`. Verify by inspecting a few new event rows.
3. **Per-company config** — set `companies.heyreach_linkedin_account_id` and `companies.heyreach_conn_req_campaigns` for the pilot company (LIFT).
4. **AgentAPI client** — `outreach-client.ts`, `outreach-prompts.ts`, types. Unit-test `normalizeChatroom` against a captured HeyReach chatroom payload.
5. **Trigger tasks** — `outreach-dispatch` (cron), `enroll-cold`, `compose-and-send`. Deploy with cron **paused**.
6. **Smoke test** — manually trigger `compose-and-send` with one `first_dm` lead and one `reply` lead (hand-picked; agent already running on :3288). Confirm: HeyReach DM arrives, `lead_messages` row written, `lead_events` row written, `funnel_stage` advanced.
7. **Enable cron** — flip the schedule on. Watch the first tick, then let it run.

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

- **Make.com payload shape.** We need to confirm HeyReach's webhook body includes a stable sender-identity marker so Make.com can deterministically set `heyreach_conversation_id` and (for Make.com and the agent both) decide `from: "us" | "them"`. If ambiguous, `normalizeChatroom` falls back to matching against `companies.heyreach_linkedin_account_id`.
- **Persona → campaign mapping maintenance.** Manual for V1 (direct SQL on `companies.heyreach_conn_req_campaigns`). If personas churn often, move to a proper join table.
- **Scout copy for replies.** Scout only produces cold openers. Replies have no `scout_copy`. Confirmed with agent PLAN §4 note: "`scout_copy.linkedin_dm` is present for `first_dm`, absent for `reply`."
- **Funnel stage on reply.** Currently the cron does not advance stage on reply send (no clean target — the lead is already past `contacted`). Revisit if downstream cares.
