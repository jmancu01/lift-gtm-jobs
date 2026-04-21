# Research & Qualify — ICP fit scoring via AgentAPI Scout

> Trigger task: `research-and-qualify`
> Source: `src/trigger/research-and-qualify/`
> Depends on: `agentapi` (scout agent, schema `scout.v1`), HubSpot, Supabase

## Why we do this

Apollo hands us a firehose of leads that match crude ICP filters (titles,
industries, headcount, geo). That's enough to get a name and an email into the
funnel, but it isn't enough to know whether we should actually waste an
outreach slot on the person. Two problems bite us on every cohort:

1. **Surface-level ICP misses real fit.** A "VP of Operations" at a 200-person
   logistics firm and a "VP of Operations" at a 200-person medical billing
   shop look identical to Apollo. Only one of them has the pain we solve.
2. **Outreach needs specificity.** Generic "I saw you work in ops…" emails get
   ignored. We need real talking points (recent news, hiring moves, product
   launches) per lead — not per persona.

The scout agent closes both gaps in one pass: it researches the person and
their company (web, LinkedIn, filings) and returns a structured ICP
qualification. We write that verdict back to HubSpot so downstream outreach,
reporting, and manual review all agree on which leads are actually worth
pursuing.

Concretely, qualifying leads before outreach means:

- **Higher reply rates.** Poor-fit leads never make it into Instantly /
  HeyReach campaigns, so our sender reputation stays clean.
- **Sharper messages.** `talking_points` and `pain_points` feed the outreach
  orchestrator; they're the difference between a template blast and a
  reason-to-reply.
- **Explainable funnel.** Every lead has an `icp_tier`, a confidence score, and
  a `fit_justification` on the HubSpot contact. Sales can see *why* a lead was
  promoted or suppressed without reading the agent transcript.

## How it works

```
leads (funnel_stage=synced, qualification_status=null)
        │
        ▼
research-and-qualify (schemaTask)
   - query batch from Supabase
   - split into chunks of 5
        │
        ▼
research-leads-batch  (task, concurrencyLimit=3 on queue "agentapi-scout")
   for each lead:
     ├─ POST /ask → scout (schema=scout.v1)   ← AgentAPI microservice
     ├─ update HubSpot contact (lift_ai_*, icp_tier, ...)
     └─ update Supabase lead (icp_tier, qualification_status, funnel_stage)
        │
        ▼
return QualifySummary (successful, qualified, not_qualified, schema_failures, ...)
```

### Selection

The orchestrator picks up leads that:

- belong to a single `company_id` (passed in payload),
- have `funnel_stage = 'synced'` (already landed in HubSpot),
- have `qualification_status IS NULL` (haven't been scored yet).

The filter is idempotent — re-running the task never re-scores a lead that
already has a verdict. You can also pass an explicit `leadIds: string[]` to
re-run a specific cohort (e.g. after fixing a bad prompt).

### Batching

- Orchestrator pulls up to `limit` leads (default 50, max 500) in one run.
- Chunks them into groups of `RESEARCH_BATCH_SIZE = 5`.
- Fan out via `researchLeadsBatch.batchTriggerAndWait`.
- Each batch task runs its 5 leads sequentially through scout.

We stay small on batch size because each `/ask` call is an LLM round-trip
(typically 30–120 s per lead). Parallel fan-out lives at the *batch* level,
not per-lead — that's what the `agentapi-scout` queue cap (3) bounds.

### Scout call

Per lead, we build a compact brief from the Supabase row and call:

```http
POST https://scout.agentapi.example.com/ask
Authorization: Bearer $AGENTAPI_AUTH_TOKEN
Content-Type: application/json
X-Lead-Id: <lead_id>

{
  "prompt": "Research lead and score ICP fit.\nName: ...\nRole: ...\n...",
  "schema": "scout.v1",
  "lead_id": "<lead_id>"
}
```

AgentAPI handles schema validation and a single repair retry internally. The
returned `parsed` block is a [`scout.v1`](../../agentapi/schemas/scout.v1.json)
document with:

- `fit_probability`: `High | Medium | Low` (scout vocabulary)
- `fit_justification`: human-readable why
- `confidence`: 0–1
- `hubspot_properties`: `lift_ai_summary`, `lift_ai_fit_tag`,
  `lift_ai_signals`, `lift_ai_phone`
- `talking_points`, `pain_points`, `recent_activity`, `sources`
- `research_quality`: `high | medium | low`

**Tier remapping.** The scout agent speaks `High / Medium / Low`. We translate
to the GTM engine's internal tier vocabulary `A / B / C` at the mapper
boundary (`scoutFitToTier`: High→A, Medium→B, Low→C) before persisting or
writing to HubSpot. Anything downstream of the batch task — `lead_ai_research.fit_tag`,
HubSpot `lift_ai_fit_tag` / `icp_tier`, `leads.icp_tier`, summary counters —
uses A/B/C. The raw `fit_probability` is preserved in `lead_events.detail.scout_fit_probability`
for auditability.

### Writeback

Two sides to the write, both inside the batch task:

**HubSpot contact** (only if `lead.hubspot_contact_id` is set):
- `lift_ai_summary` ← `hubspot_properties.lift_ai_summary`
- `lift_ai_fit_tag` ← `scoutFitToTier(hubspot_properties.lift_ai_fit_tag)` (A/B/C)
- `lift_ai_signals` ← `hubspot_properties.lift_ai_signals`
- `lift_ai_phone` ← `hubspot_properties.lift_ai_phone`
- `icp_tier` ← same tier (A/B/C)
- `icp_score` ← `round(confidence * 100)`
- `qualification_status` ← `qualified` if tier ≠ C else `not_qualified`
- `qualification_date` ← now

**Supabase `leads` row**:
- Same ICP fields (`icp_tier`, `icp_score`, `qualification_status`,
  `qualified_at`).
- `funnel_stage` → `qualified` or `disqualified`.
- `suppression_reason = 'low_icp_fit'` (+`suppressed_at`) for Low-fit leads,
  so the outreach stage can filter them out with a single column check.

A `lead_events` row is written (`event_type: qualified | disqualified`,
`source_system: agentapi-scout`) so we can audit the funnel retroactively.

### Failure modes

| Situation | Behavior |
|---|---|
| Scout `/ask` returns 400 schema failure (after its own repair retry) | `schema_failures++`, `failed++`, lead stays unqualified — will be retried by the next run. **We do not re-hit `/ask`** (per the client contract). |
| Scout HTTP error (5xx, network) | `failed++`, lead stays unqualified. |
| HubSpot write fails | `failed++`, but Supabase write still runs in the same iteration if reached. On transient 429 the HubSpot client backs off internally. |
| Lead has no `hubspot_contact_id` | `hubspot_missing++`, Supabase still updated — lead was qualified but not reflected in CRM until the next `sync-to-hubspot`. |

Only one `/ask` per lead per run. Retries are left to the orchestrator being
triggered again; idempotency comes from the `qualification_status IS NULL`
filter.

## Integrating with the scout AgentAPI microservice

### 1. Environment

Add to the Trigger.dev project env:

```
AGENTAPI_SCOUT_URL=https://scout.agentapi.example.com
AGENTAPI_AUTH_TOKEN=<shared bearer token>
```

Locally:

```
AGENTAPI_SCOUT_URL=http://localhost:3285
AGENTAPI_AUTH_TOKEN=test
```

`AGENTAPI_SCOUT_URL` is required (client throws on missing). `AGENTAPI_AUTH_TOKEN`
is optional — if empty, no `Authorization` header is sent (matches the dev-mode
"empty token = no auth" behavior on the server).

### 2. HubSpot custom properties

The scout agent drives four custom contact properties. Create them once per
portal:

| Property | Type | Options |
|---|---|---|
| `lift_ai_summary` | multi-line text | — |
| `lift_ai_fit_tag` | dropdown | `A`, `B`, `C` (case-sensitive; match `scoutFitToTier` output) |
| `lift_ai_signals` | multi-line text | — |
| `lift_ai_phone` | single-line text | — |

Existing properties we reuse: `icp_tier`, `icp_score`, `qualification_status`,
`qualification_date`.

### 3. Running the task

**Manual trigger** (Trigger.dev dashboard or SDK):

```ts
await researchAndQualify.trigger({
  companyId: "<uuid>",
  limit: 50,           // optional, default 50, max 500
  dryRun: false,       // optional, default false
});
```

**Targeted re-score**:

```ts
await researchAndQualify.trigger({
  companyId: "<uuid>",
  leadIds: ["<lead-uuid>", ...],
});
```

**Chained from discovery**: the discovery pipeline already chains
`sync-to-hubspot`. Add a follow-on chain in the same place if you want
synchronous end-to-end processing:

```ts
// after sync-to-hubspot handle...
await researchAndQualify.trigger({ companyId, leadIds: newLeadIds });
```

### 4. Local integration test

```bash
# terminal 1 — run the scout agent locally
cd ~/Developer/LIFT/agentapi
make dev/scout        # binds :3285 with AGENTAPI_AUTH_TOKEN=test (if using wrapper)

# terminal 2 — run the Trigger.dev worker
cd ~/Developer/LIFT/lift-gtm-jobs
AGENTAPI_SCOUT_URL=http://localhost:3285 \
AGENTAPI_AUTH_TOKEN=test \
npm run dev

# trigger the task from the dashboard or programmatically with
# { companyId, limit: 5, dryRun: true }
```

In `dryRun: true`, the task still calls scout (so you can eyeball real output
and cost) but skips every HubSpot PATCH and Supabase update. Summary is
logged as usual.

### 5. Things to watch

- **Cost.** One `/ask` ≈ one Claude run; scout with browsing is 2–10× a plain
  completion. `limit=50` ≈ 50 runs per execution. Keep `research-and-qualify`
  on manual or low-frequency schedule until you have a cost baseline.
- **Pool capacity.** Scout is replicated across `3285/3295/3305` in prod.
  `concurrencyLimit = 3` on the `agentapi-scout` queue matches the pool size;
  bump only after you verify Caddy actually fans out requests.
- **Schema drift.** If scout changes to `scout.v2`, both this repo and the
  agent need to ship together. Fetch `GET /schemas/scout.v1` at build time
  (unauthenticated) to catch mismatches early — we don't currently do this
  but it's a cheap add.
- **Don't re-ask on 400.** `AgentApiSchemaError` is treated as terminal for
  the lead in this run. Scout already gets one repair retry inside `/ask`;
  looping on 400 costs money without fixing anything. Fall back or fix the
  prompt.
