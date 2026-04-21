# research-and-qualify — guía de testing

Cómo correr esta task localmente y las particularidades operacionales que aprendimos en dev. Complementa a [`docs/research-and-qualify.md`](../../../docs/research-and-qualify.md) (que explica *qué hace* y *por qué*) — este documento es solo *cómo probarla sin romper nada*.

## Preconditions

### 1. Scout corriendo localmente

```bash
cd ~/Developer/LIFT/agentapi
make dev/scout           # bindea :3285
# smoke:
curl -sS http://localhost:3285/healthz
curl -sS http://localhost:3285/readyz   # { "conversation": "stable" }
curl -sS http://localhost:3285/schemas/scout.v1 -o /dev/null -w "%{http_code}\n"   # 200
```

Si `make dev/scout` no usa auth, el servidor acepta cualquier request. Si lo corriste con `AGENTAPI_AUTH_TOKEN=test`, el cliente manda `Authorization: Bearer test` (definido vía `.env`).

### 2. `.env` en `lift-gtm-jobs/`

```
AGENTAPI_SCOUT_URL=http://localhost:3285
AGENTAPI_AUTH_TOKEN=test
SUPABASE_URL=https://ycwarkyijoeunmgjbikm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
# HUBSPOT_API_KEY solo se usa si skipHubspot=false
```

### 3. Dev server de Trigger.dev

```bash
cd ~/Developer/LIFT/lift-gtm-jobs
npm run dev
# esperar: "Local worker ready [node] -> YYYYMMDD.N"
```

Cambios en `src/` disparan rebuild automático — el worker bumpea `.1 → .2 → .3` por cada guardado.

## Modos de corrida

La task acepta cuatro flags combinables:

| Flag | Default | Efecto |
|---|---|---|
| `companyId` | — (requerido) | UUID de `public.companies`. Filtra leads y saca `hubspot_access_token`. |
| `leadIds` | `undefined` | Si se pasa, bypass del filtro `funnel_stage=synced AND qualification_status IS NULL`. **Útil para re-testear un lead ya qualificado.** |
| `limit` | 50 | Tope de leads por run (cuando no hay `leadIds`). |
| `dryRun` | `false` | Si `true`: llama a scout (gasta LLM) pero **no escribe nada**. Ni Supabase ni HubSpot. |
| `skipHubspot` | `false` | Si `true`: escribe Supabase (`lead_ai_research` + `leads` verdict) pero **no toca HubSpot**. `dryRun` gana si también es `true`. |

### Matriz de corridas sugeridas

| Objetivo | `dryRun` | `skipHubspot` | Escribe Supabase | Escribe HubSpot | Costo scout |
|---|---|---|---|---|---|
| Smoke — ¿el prompt + schema funcionan? | `true` | — | ❌ | ❌ | 💰 |
| Validar writeback a Supabase sin tocar CRM | `false` | `true` | ✅ | ❌ | 💰 |
| Run completo (end-to-end) | `false` | `false` | ✅ | ✅ | 💰 |
| Debug sin gastar LLM | n/a | n/a | — | — | Pará scout antes de disparar; la task fallará con `AgentApiSchemaError`/connection refused y no escribe nada. |

### Cómo disparar

Desde el dashboard de Trigger.dev o por MCP:

```jsonc
// research-and-qualify payload
{
  "companyId": "5fc351fb-218c-4f11-a234-58e5802893da",
  "leadIds":   ["9b3ac643-6ecc-4275-bb73-e0c61e40634e"],
  "dryRun":    false,
  "skipHubspot": true,
  "limit":     1
}
```

O programáticamente:

```ts
import { researchAndQualify } from "./index.js";
await researchAndQualify.trigger({ companyId, leadIds, dryRun: true });
```

## Cómo elegir un lead para testear

Desde SQL:

```sql
-- leads ya en HubSpot, pendientes de scorear
select id, first_name, last_name, title, company_name, company_domain, hubspot_contact_id
from public.leads
where funnel_stage = 'synced'
  and qualification_status is null
  and hubspot_contact_id is not null
order by synced_at desc nulls last
limit 10;
```

O un lead que ya tiene scoring legacy (`icp_tier = 'A'/'B'/'C'` desde el sistema viejo — pasalo vía `leadIds` para forzar el reprocesado).

## Particularidades que duelen

### 1. Timeout del cliente vs duración real de scout

El cliente aborta después de **10 minutos** (`DEFAULT_TIMEOUT_MS` en `src/lib/agentapi/client.ts`). Scout con browsing real tarda 30s–8min por lead. Si excede 10min:

- El cliente tira `AbortError` → la task loggea `scout /ask failed` y marca el lead como `failed`.
- **Scout sigue procesando en el server** (no sabe que el cliente se fue). `GET /status` muestra `"running"`.
- El próximo `/ask` devuelve **HTTP 500** con `"message can only be sent when the agent is waiting for user input"` hasta que scout vuelva a `stable`.

Si ves este 500, esperá a que scout termine:

```bash
until curl -sS -H "Authorization: Bearer test" http://localhost:3285/status | grep -q '"status":"stable"'; do
  sleep 5
done
```

### 2. Remapping High/Medium/Low → A/B/C

Scout respeta el schema `scout.v1` y devuelve `fit_probability: "High" | "Medium" | "Low"`. La traducción pasa en `scoutFitToTier` (`src/lib/agentapi/types.ts`):

```
High   → A
Medium → B
Low    → C
```

Todo lo que se persiste (Supabase, HubSpot, summary counters, events) usa **A/B/C**. El valor crudo queda en `lead_events.detail.scout_fit_probability` para auditar. La dropdown `lift_ai_fit_tag` en HubSpot **debe estar configurada con las opciones A/B/C**, no con High/Medium/Low.

### 3. Disqualification rule

`tier === "C"` (ex-`Low`) → `qualification_status = "not_qualified"`, `funnel_stage = "disqualified"`, `suppression_reason = "low_icp_fit"`. A y B quedan `qualified`.

### 4. Historial en `lead_ai_research`

Cada run **inserta una row nueva** y marca las anteriores como `superseded_at = now()`. Para ver solo la verdad actual:

```sql
select * from public.lead_ai_research
where lead_id = '...' and superseded_at is null;
```

Nunca hacemos `delete` — re-correr la task no "limpia" filas anteriores, las archiva.

### 5. `leads` vs `lead_ai_research`

La tabla `leads` tiene el **verdict** (`icp_tier`, `icp_score`, `qualification_status`, `funnel_stage`). La tabla `lead_ai_research` tiene el **detalle** (summary, signals, talking_points, sources, etc.). **Reemplaza** el scoring legacy de `leads` — si el sistema viejo sigue corriendo en paralelo, se van a pisar.

### 6. Idempotencia

- **Sin `leadIds`**: la task filtra `qualification_status IS NULL`. Re-correr la task **no reprocesa** leads ya scoreados.
- **Con `leadIds`**: bypass del filtro → **sí reprocesa**. Cada corrida agrega una fila nueva en `lead_ai_research` (con `superseded_at` seteado en las anteriores).

### 7. `companyId` tiene que ser real

`getCompanyById` es `.single()` — si pasás un UUID inválido (ej. todo ceros), la task falla en el orquestador con `Company ... not found: Cannot coerce the result to a single JSON object` antes de llamar a scout. El UUID tiene que estar en `public.companies`. Para sacar el `companyId` de un lead:

```bash
curl -sS "$SUPABASE_URL/rest/v1/leads?id=eq.<LEAD_ID>&select=company_id" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

### 8. `skipHubspot` no afecta el lead_events

`lead_events.detail.skipped_hubspot: true/false` queda anotado. Si después querés hacer un run "solo HubSpot" para catch-up, hay que reprocesar el lead (`leadIds`) — no hay path parcial "solo-HubSpot" hoy.

## Verificación post-run

### En Trigger.dev

Dashboard → Runs → filter tag `smoke_test`. El run padre tiene `Output` con el summary. El child `research-leads-batch` tiene el trace (scout /ask, insert research, updateLead, writeback a HubSpot).

### En Supabase

```sql
-- research row vigente para el lead
select id, fit_tag, confidence, research_quality, created_at, run_id
from public.lead_ai_research
where lead_id = '9b3ac643-6ecc-4275-bb73-e0c61e40634e'
  and superseded_at is null;

-- verdict en leads
select id, icp_tier, icp_score, qualification_status, funnel_stage, qualified_at
from public.leads
where id = '9b3ac643-6ecc-4275-bb73-e0c61e40634e';

-- evento
select event_type, detail, created_at
from public.lead_events
where lead_id = '9b3ac643-6ecc-4275-bb73-e0c61e40634e'
order by created_at desc
limit 5;
```

### En HubSpot (si `skipHubspot=false`)

Buscá el contacto por email o `hubspot_contact_id`. Propiedades que deberían estar:

- `lift_ai_summary` (text, ~300-800 chars)
- `lift_ai_fit_tag` (A / B / C)
- `lift_ai_signals` (text, comma-separated)
- `lift_ai_phone` (string or empty)
- `icp_tier`, `icp_score`, `qualification_status`, `qualification_date`

## Rollback manual de un test lead

Después de un run `dryRun=false`, si querés volver a cero para rerun:

```sql
-- 1. Borrar TODAS las research rows del lead (no importa supersede — si el lead
--    va a ser reprocesado, estás tirando historial a propósito)
delete from public.lead_ai_research
where lead_id = '<LEAD_ID>';

-- 2. Resetear verdict en leads
update public.leads
set icp_tier = null,
    icp_score = null,
    qualification_status = null,
    qualified_at = null,
    funnel_stage = 'synced',
    suppression_reason = null,
    suppressed_at = null
where id = '<LEAD_ID>';

-- 3. (Opcional) limpiar eventos del último run
delete from public.lead_events
where lead_id = '<LEAD_ID>'
  and source_system = 'agentapi-scout'
  and created_at > now() - interval '1 hour';
```

En HubSpot, las propiedades custom no se pueden borrar con un update vacío — hay que PATCH-ear con valores placeholder o dejar como están (la próxima corrida las sobreescribe).

## Errores comunes

| Síntoma | Causa | Fix |
|---|---|---|
| `AGENTAPI_SCOUT_URL environment variable is required` al iniciar la task | Falta la env var en `.env` o en el deploy de Trigger.dev | Agregar al `.env` + rebuild del worker |
| `scout /ask failed` con `AbortError` a los 10 min | Scout se colgó o está procesando algo largo | Esperar `status: stable` antes del próximo `/ask`; si se repite, revisar que scout tenga acceso a internet |
| `message can only be sent when the agent is waiting for user input` (500) | Scout está en `running` (run anterior abortó del lado cliente) | Esperar stable |
| `scout schema validation failed` — `AgentApiSchemaError` | Scout no pudo producir JSON válido ni después del repair retry | **No retries en 400** — cae como `schema_failures` en el summary, fallback a persona template |
| `Company ... not found` | `companyId` inválido | Usar un UUID de `public.companies` |
| Summary dice `hubspot_missing: 1` | El lead no tiene `hubspot_contact_id` en Supabase | Correr `sync-to-hubspot` primero, o pasar un lead ya syncado |
| Summary dice `hubspot_updated: 0` pero esperabas más | `skipHubspot: true` o `dryRun: true` | Chequear los flags del payload |
| Los valores de `icp_tier` son letras mezcladas (ej. "Medium") | Hay código legacy escribiendo en paralelo | Buscá qué otro job/edge function toca `leads.icp_tier` |

## Costos

Cada `/ask` ≈ 1 Claude run con browsing. Scout en dev local contra Claude personal del user cuesta ~$0.05–$0.30 por lead según cuánto navegue. Multiplicá por `limit` antes de disparar runs grandes. **Default `limit: 50`** — si testeás con un solo lead, siempre pasá `limit: 1` o `leadIds: [...]`.

## Referencias

- `src/trigger/research-and-qualify/index.ts` — orquestador
- `src/trigger/research-and-qualify/research-leads-batch.ts` — batch task
- `src/lib/agentapi/` — cliente scout + mappers
- `src/lib/supabase/research.ts` — insert + supersede helper
- `supabase/migrations/20260421120000_add_lead_ai_research.sql` — tabla
- `supabase/migrations/20260421130000_remap_lead_ai_research_fit_tag_to_abc.sql` — A/B/C check
- [`docs/research-and-qualify.md`](../../../docs/research-and-qualify.md) — diseño y motivación
