# Keboola JS Data App — Pitfalls

Every item here caused hours of debugging on a prior build. Read the list before shipping, and copy the fix pattern into your app.

## 1. Kai chat drops mid-stream when proxied as SSE

**Symptom:** browser fetch throws `network error` after 30–60 seconds of Kai response, or after 3–4 tool calls. Server logs show `[kai] upstream done @ 58.2s (chunks=682, bytes=104494)` — the Node process completed the stream, but the client only received a partial response.

**Root cause:** something in the Keboola ingress chain between the container and the browser drops the long-lived HTTP connection. `proxy_buffering off`, `X-Accel-Buffering: no`, 10-second keep-alive `: ping\n\n` frames, disabled Node timeouts — none of them help. Reproduced consistently, not something the app can fix.

**Fix:** do not proxy the SSE stream. Instead:
1. `POST /api/chat/start` — server kicks off the upstream Kai fetch in the background, stores raw SSE bytes in an in-memory `Map<streamId, buffer>`, returns `{streamId}` immediately.
2. `GET /api/chat/poll?id=X&from=N` — server returns `{chunk: raw.slice(from), total: raw.length, done, error}`.
3. Client polls every 300–500 ms, appends `chunk` to a local buffer, parses SSE frames the same way as before.

Each poll is a sub-second HTTP round-trip → no intermediary can drop it. See `references/server-index.ts` for the full pattern.

## 2. STORAGE_API_TOKEN vs KBC_TOKEN — Kai returns 403

**Symptom:** `POST /api/chat/*` returns 403 with body `{"code":"forbidden"}`. Discovery of `/v2/storage` works fine.

**Root cause:** the auto-injected `KBC_TOKEN` is a workspace-scoped token. `kai-assistant` is a tenant-wide service that requires a Full Access token. Discovery works because it hits Storage API, but the Kai endpoint itself refuses the scoped token.

**Fix:** manually create a Full Access token in **Settings → API Tokens** and add it as a secret named `STORAGE_API_TOKEN` in **Data App → Advanced Settings → Secrets**. Server code should prefer it:

```ts
function getKaiToken() {
  return process.env.STORAGE_API_TOKEN || process.env.KBC_TOKEN || '';
}
```

If `STORAGE_API_TOKEN` is missing, return a friendly error to the frontend explaining exactly how to add it — silent 403s are hell to debug.

## 3. Kai rejects `branchId: null` with 400

**Symptom:** `POST /api/chat/start` returns `400 bad_request` with body like:

```json
{"code":"bad_request:api","message":"invalid_type","cause":"path: [branchId], expected: number, received: null"}
```

**Root cause:** the Kai server's Zod schema validates `branchId` as `number` when present. The Python `kai-client` uses `exclude_none=True` on serialization, so it never sends the null. Node's `JSON.stringify` DOES send the null.

**Fix:** either send `BRANCH_ID` from env as a number, or omit the field entirely:

```ts
const body = { ...req.body };
const envBranch = process.env.BRANCH_ID ? Number(process.env.BRANCH_ID) : undefined;
if (envBranch && Number.isFinite(envBranch)) {
  body.branchId = envBranch;
} else if (body.branchId == null) {
  delete body.branchId;
}
```

## 4. Kai SSE parser: field is `delta`, not `textDelta`

**Symptom:** Ask Kai UI shows an empty assistant bubble. No error, no network problem — the stream ends cleanly with nothing rendered.

**Root cause:** many older SSE parsers assume `text-delta` events have a `textDelta` field. Kai sends:

```json
{"type": "text-delta", "delta": "…text piece…"}
```

If you look for `event.textDelta` you'll get `undefined` and skip the frame.

**Fix:**

```ts
if (event.type === 'text-delta') {
  text = event.delta || event.textDelta || '';
}
```

While you're there, also handle: `type: 'text'` (full text), `type: 'tool-input-available'` (surface which tool Kai is calling), `type: 'error'` (surface Kai errors). See `references/AskKaiPage.tsx`.

## 5. Kai service discovery — look for `kai-assistant`

**Symptom:** discovery finds services but not Kai. Logs show `Available services: docker-runner, import, syrup, oauth, sqldep-analyzer, queue, sandboxes, billing, ai, buffer, ...`.

**Root cause:** the service ID is `kai-assistant`, not `kai` or `ai`. `ai` may also exist but points at a different (deprecated) service on some regions.

**Fix:** search for `kai-assistant` first, fall back to `ai`, then `.includes('kai')` as last resort. Log the full available services list so you can diagnose if the ID ever changes:

```ts
console.debug('[kai] Available services:', services.map(s => s.id).join(', '));
const kai = services.find(s => s.id === 'kai-assistant') || services.find(s => s.id === 'ai');
```

## 6. Snowflake `pageSize` silently truncates results at 10 000

**Symptom:** a table you know contains 14 045 rows returns exactly 10 000 rows. Adding `LIMIT 20000` to your SQL doesn't help.

**Root cause:** Snowflake executes the whole query and returns all rows to Keboola's query result endpoint. That endpoint paginates. The `pageSize` parameter is the max rows returned in ONE response — not a query limit. If your wrapper is hardcoded to `pageSize: 10000`, you get exactly 10 000 rows regardless of the SQL.

**Fix:** bump the default in your query helper. Keboola's API cap is 100 000; 50 000 covers every realistic pre-agg table:

```ts
const DEFAULT_PAGE_SIZE = 50_000;
```

If your table can exceed 50 000 rows, implement pagination (loop over `offset=0, 50000, 100000, …` until fewer than `pageSize` rows come back).

## 7. Transformation `LIMIT N` produces silently distorted charts

**Symptom:** a chart or hero KPI shows an exact round number like 10 000, and a histogram derived from the same detail table looks weirdly skewed toward extreme values.

**Root cause:** the pre-agg transformation SQL ended with `ORDER BY x DESC LIMIT 10000`. The KPI count (single-row KPIs table) may correctly say 103 350, but the detail table only holds the top 10 000. Building a histogram from `detail.filter(bucket=X).length` gives you the distribution of the *truncated slice*, not the real population.

**Fix:** two-part

**a)** Never derive a hero count from `detail_table.length`. Add an explicit KPI column:

```sql
(SELECT COUNT(*) FROM (
  SELECT "DOC_ID" FROM "IN_LINE_ITEMS" WHERE "DOC_ID" IS NOT NULL
  GROUP BY "DOC_ID" HAVING COUNT(*) >= 2
)) AS n_multi_line_items_docs,
```

**b)** For histograms, add a separate small bucket table (`ACC_*_BUCKETS`) with (`bucket`, `n_docs`) — 5–10 rows, unlimited coverage:

```sql
CREATE OR REPLACE TABLE "ACC_PAYMENT_MULTI_LINE_ITEMS_BUCKETS" AS
WITH per_doc AS (
  SELECT "DOC_ID", COUNT(*) AS n_items FROM "IN_LINE_ITEMS"
  WHERE "DOC_ID" IS NOT NULL GROUP BY "DOC_ID" HAVING COUNT(*) >= 2
)
SELECT
  CASE WHEN n_items = 2 THEN '2' WHEN n_items = 3 THEN '3'
       WHEN n_items = 4 THEN '4' WHEN n_items = 5 THEN '5'
       WHEN n_items BETWEEN 6 AND 10 THEN '6-10'
       ELSE '11+' END AS bucket,
  MIN(n_items) AS min_items,
  COUNT(*) AS n_docs
FROM per_doc GROUP BY 1 ORDER BY MIN(n_items);
```

## 8. `SNAPSHOT_AT` renders as "Invalid Date"

**Symptom:** the snapshot timestamp in the UI reads "Invalid Date" or "1970-01-01".

**Root cause:** Snowflake returns `CURRENT_TIMESTAMP()` as Unix epoch seconds (float, sometimes as a string like `"1782128710.87"`). JavaScript's `new Date(x)` expects milliseconds if you pass a number, and returns `Invalid Date` if you pass a numeric string.

**Fix:** convert on the server before responding:

```ts
snapshotAt: (() => {
  const raw = kpis[0]?.SNAPSHOT_AT;
  const seconds = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
})(),
```

## 9. MSSQL extractor lands every column as VARCHAR

**Symptom:** `WHERE btrAmount > 1000` returns wrong rows. Comparing `'999.00' > 1000` gives inconsistent alphabetical comparisons.

**Root cause:** the Keboola MSSQL extractor (`keboola.ex-db-mssql`) casts every source column to VARCHAR when landing. Even `int` and `datetime` come through as strings.

**Fix:** always cast before math/date operations:

```sql
WHERE TRY_CAST("btrAmount" AS NUMBER(20,3)) > 1000
WHERE TRY_CAST("btrDate" AS TIMESTAMP_NTZ) >= '2024-01-01'
```

Use `TRY_CAST` (not `CAST`) — bad rows return NULL instead of failing the whole query.

## 10. UUID case mismatches across buckets

**Symptom:** a cross-bucket JOIN on a UUID column returns zero rows even though you know both sides have the same IDs.

**Root cause:** UUIDs from the MSSQL extractor arrive lower-case; UUIDs in curated BDM/DWH buckets are UPPERCASE. Equality fails.

**Fix:** case-fold both sides:

```sql
ON UPPER(dp."PL_DOC_PAYMENT_ID") = UPPER(b."btrDpmId")
```

This breaks index use (function-on-column), but for one-off pre-agg transformations it's fine. For hot lookups, normalize case in the producer transformation once.

## 11. `TRY_PARSE_JSON` not `PARSE_JSON`

`PARSE_JSON` throws on malformed rows and kills the whole query. `TRY_PARSE_JSON` returns NULL on bad rows. Always use `TRY_PARSE_JSON` on wild data.

```sql
TRY_PARSE_JSON("dpmInfo"):"variableSymbol"::string AS vs
```

## 12. Filter values may have parenthesised alternates

**Symptom:** payment method breakdown shows a card with 97 % labeled `(not bank api)` — a value you thought you filtered out.

**Root cause:** the source data actually stores `(not_bank_api)` with parentheses (a common "empty / not applicable" convention in analytics tables). Your filter checked for `not_bank_api` without the parens and missed it.

**Fix:** normalize before comparing:

```ts
.filter((k) => {
  const kind = String(k.BANK_API_KIND).toLowerCase().replace(/[()]/g, '').trim();
  return kind && kind !== 'not_bank_api';
})
```

## 13. Column name typos are silent

**Symptom:** a card shows 0 %. No error.

**Root cause:** you read `expenseKpis.PCT_LINKED_TO_DOCS` (plural). The real column is `PCT_LINKED_TO_DOC` (singular). `Number(undefined)` is `NaN`, `(NaN).toFixed(0)` is `"NaN"`, but `<CountUp value={NaN}>` renders as 0.

**Fix:** two-line guardrail before adding any KPI card — query the KPI table directly with `SELECT * … LIMIT 1` and copy the column names from the header. Never rely on memory or auto-complete.

## 14. Container doesn't restart on `git push`

**Symptom:** you pushed a fix minutes ago, opened the app URL, and it still shows the old bug.

**Root cause:** Keboola pulls the git repo on **container start**, not on push. A running container serves cached code until:
- auto-suspend timer elapses (default `autoSuspendAfterSeconds: 300` — 5 minutes, per the platform's own deploy defaults; do not assume 900/15-min, confirm in the app's Advanced Settings), then next request pulls fresh code
- OR you click **Redeploy** in the app config UI
- OR you call `mcp__<project>__deploy_data_app` with the config ID

**Fix during dev:** click Redeploy after each push. **Do not** call `deploy_data_app` from Claude without asking the user first — deploys are user-facing side effects.

## 15. Output storage mapping is not automatic

**Symptom:** you added a `CREATE OR REPLACE TABLE "ACC_NEW_METRIC"` block to a transformation, the job runs green, but querying `out.c-metrics_v2.ACC_NEW_METRIC` returns "object does not exist or not authorized".

**Root cause:** the transformation runs in a Snowflake workspace. Tables created there stay in the workspace unless declared in `storage.output.tables`. Keboola only exports declared outputs to Storage buckets.

**Fix:** update the transformation config's `storage.output.tables`:

```json
{"source": "ACC_NEW_METRIC", "destination": "out.c-metrics_v2.ACC_NEW_METRIC"}
```

Then re-run the job. Do it via `update_sql_transformation` MCP (with the full storage object — it replaces, doesn't merge).

## 16. Number formatting — always `cs-CZ` locale, always thousands separator

`(123456).toLocaleString('cs-CZ')` → `"123 456"` (non-breaking spaces). `.toString()` gives `"123456"` — hard to read for large money numbers. Use `toLocaleString('cs-CZ')` everywhere the audience is Czech.

## 17. `import.meta.env.DEV` fails TypeScript in unusual scopes

Some Vite scaffolds don't ship the `import.meta.env` type in every scope. Guard it with a helper or just remove the `if (DEV)` gate and always `console.debug` in the hot path — debug logs in production are cheap.

## 18. Auto-suspend suspends without warning

Users report "the app takes 20 seconds to load" — the container was suspended and the first request has to spin it up. This is by design (`autoSuspendAfterSeconds: 300` by default — 5 minutes). For a demo before a board meeting, warm the app 2 minutes before the meeting starts by opening its URL.

## 19. Node HTTP endpoint is always `/api/chat`

The Kai HTTP API has only ONE endpoint that matters for chat: `POST /api/chat`. Skip fallback to `/chat` or `/v1/chat` — they don't exist. If you get 404, the discovered base URL is wrong (region mismatch), not the path.

## 21. `"type": "module"` in package.json crashes the compiled server on boot

**Symptom:** container starts, immediately exits, supervisord gives up after a few retries.
Startup logs show:

```
ReferenceError: exports is not defined in ES module scope
This file is being treated as an ES module because it has a '.js' file extension and
'/app/package.json' contains "type": "module". To treat it as a CommonJS script, rename it
to use the '.cjs' file extension.
    at file:///app/dist/server/index.js:5:23
```

**Root cause:** `tsconfig.server.json` compiles `server/*.ts` to CommonJS
(`module: "CommonJS"`, using `exports.foo = …`). If `package.json` also declares
`"type": "module"`, Node treats every `.js` file — including the compiled
`dist/server/index.js` — as an ES module regardless of its actual syntax, and CommonJS's
`exports` object doesn't exist in that scope.

**Fix:** don't set `"type": "module"` in `package.json` at all. The frontend build (Vite)
doesn't need it — Vite bundles and serves the browser build independently of Node's module
resolution. Keep `tailwind.config.js` and `postcss.config.js` as `module.exports = {...}`
(not `export default`) to match; otherwise Node prints a
`[MODULE_TYPELESS_PACKAGE_JSON]` reparse warning for them (harmless, but noisy).

## 22. Tailwind colors referenced in the design skill's CSS but missing from `tailwind.config.js`

**Symptom:** `npm run build` fails with `[postcss] The 'to-brand-accent' class does not exist`
(or any other `brand-*` class) even though `tailwind.config.js` was copied from this skill.

**Root cause:** the design skill's `index.css` (`.nav-item.active`) uses
`from-brand-primary to-brand-accent`, but this skill's `tailwind.config.js` template only
defined `brand.purple`, not `brand.accent` — same hex value, different key.

**Fix:** the template now includes both `accent` and `purple` keys (identical value) so either
naming works. If you hand-roll the Tailwind config instead of copying the template, define
`brand.accent` explicitly.

## 23. SQL `BOOLEAN` columns arrive as the strings `"true"`/`"false"`, not JS booleans

**Symptom:** a client-side filter like `if (status === 'active' && row.IS_DELETED) return false`
excludes every row regardless of the row's actual value — a status filter that always returns
nothing, or a badge that always renders.

**Root cause:** the Snowflake Query Service results endpoint (used by `runSnowflakeQuery` in
`kbcQuery.ts`) returns every cell as a string, including SQL `BOOLEAN`/`CASE…THEN TRUE ELSE
FALSE END` columns. The string `"false"` is truthy in JavaScript, so any code that treats the
field as a real boolean (`if (row.IS_DELETED)`, `row.IS_DELETED && …`) behaves as if it were
always `true`.

**Fix:** never branch on a boolean-typed column directly. Add a small coercion helper and use it
everywhere the column is read, both for filtering and for conditional rendering:

```ts
function isTrue(v: unknown): boolean {
  return v === true || v === 'true';
}
```

Type the field as `boolean | string` in your TS interfaces (not `boolean`) as a reminder that the
runtime value isn't a real boolean.

## 24. Time-series chart X-axis renders out of chronological order

**Symptom:** a line/area/bar chart over dates or week labels ("W01", "W02"…) zig-zags instead of
trending left-to-right, even though the producing SQL had an `ORDER BY`.

**Root cause:** row order from `queryTable()`/the Snowflake results endpoint is not a contract —
it can be preserved end-to-end today and silently lost tomorrow (a client-side filter/slice
re-orders the array, `Array.from(new Set(...))` preserves insertion order not sort order, etc).
Relying on "the SQL already sorted it" is fragile because the sort guarantee lives far from the
chart code that assumes it.

Week-label strings compound this: `["W1", "W10", "W2"]` sorts alphabetically before numeric
sort, e.g. `Array.from(new Set(weekLabels)).sort()` puts `W10` between `W1` and `W2`.

**Fix:** always sort chart data explicitly, client-side, right before rendering — never assume
upstream order:

```ts
const trend = rows
  .map((r) => ({ date: r.RUN_DATE, value: Number(r.VALUE) || 0 }))
  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

const weeks = Array.from(new Set(rows.map((r) => r.WEEK_LABEL))).sort(
  (a, b) => parseInt(a.replace('W', ''), 10) - parseInt(b.replace('W', ''), 10),
);
```

## 20. The `MULTI_LINE_ITEMS_DOCS`-style 10 000 exactly

Any table showing exactly a round number like 10 000, 50 000, 100 000 is almost certainly `LIMIT`ed at that number in the producer transformation. Verify by running `SELECT COUNT(*) FROM …` against the underlying source, not against the pre-agg. If the source has more rows, the pre-agg is a truncated sample and any distribution derived from it is distorted (top-N by whatever the `ORDER BY` prioritizes).

## 25. Filter selections sent over a GET query string → 431 Request Header Fields Too Large

**Symptom:** a dynamic-filter tab renders its controls fine, then the data call fails with `431`. The failing request is a GET like `/api/total-searches?f=<huge JSON>`.

**Root cause:** you serialised the current filter selection into the URL, and one dimension ("division", "city", "SKU"…) has **thousands of values all selected by default**. The query string blows past the server/proxy header-size limit. This only bites dynamic-filter apps — the read-once `/api/data/all` model never sends filters.

**Fix (two parts):**

**a) Use POST, not GET, for filter-heavy endpoints.** Send the filter object as a JSON body — bodies have no header-size limit. A small `usePost()` hook mirrors `useFetch()` but posts and re-runs when `url + JSON.stringify(body)` changes.

**b) Send a fully-selected dimension as `null` = "no filter".** Don't ship 3 000 division names when the user hasn't narrowed anything. On the client, compact each dimension: `sel.length === all.length ? null : sel`. On the server, distinguish three cases:

```ts
// null  => fully selected ("All") => NO clause (and no giant IN list in the SQL)
// []    => nothing selected       => 1=0 (empty result)
// [...] => IN (...) for the subset
function whereIn(col: string, values: string[] | null): string | null {
  return values === null ? null : sqlIn(col, values); // sqlIn([]) === '1=0'
}
```

This also makes the SQL faster — no thousands-element `IN` clause when a dimension isn't narrowed.

## 26. `vite build` does NOT type-check the frontend

**Symptom:** the build is green but the app has type errors (wrong prop types, missing fields) that only surface as runtime bugs.

**Root cause:** Vite compiles TS with esbuild, which **strips types without checking them**. `npm run build` (`vite build && tsc -p tsconfig.server.json`) only type-checks the *server*.

**Fix:** run `npx tsc --noEmit` (the `typecheck` script) on the frontend before shipping, and treat it as part of "build passes". CI should run both.

## 27. `get_data_apps` detail can exceed the tool's token limit

**Symptom:** fetching an existing app's config to port or inspect it returns "result exceeds maximum allowed tokens" — the Streamlit `parameters.script` alone can be 50–60 KB.

**Fix:** the tool saves the full JSON to a file and prints the path. Don't retry the tool; instead extract what you need from that file, e.g.:

```bash
python -c "import json;d=json.load(open('<file>',encoding='utf-8'));a=d['data_apps'][0];\
open('app.py','w',encoding='utf-8').write('\n'.join(a['configuration']['parameters']['script']) \
if isinstance(a['configuration']['parameters']['script'],list) else a['configuration']['parameters']['script'])"
```

Then read `app.py` locally. `parameters.script` is a one-element list-of-string on some apps and a plain string on others — handle both.

## 29. Restricting an app to a Google Group ("only members of X can see this report")

Full pattern in a separate reference file: `references/google-group-access.md`. Short version:
use the **Cloud Identity Groups API** (service account just needs Owner/Manager on the target
Google Group — no domain-wide delegation, no impersonation, no Workspace admin role needed), and
**always exempt Kubernetes health-check paths** from the gate middleware or the deploy will die
with `StartupDeadlineExceeded` on the very first try.

## 28. Iterating tweak-by-tweak makes every change feel like 5-15 minutes

**Symptom:** a design-review session ("let's walk through each tab and fix what looks off") where every single small CSS/copy fix feels like it takes minutes, even though no individual command is slow.

**Root cause — two independent factors, don't conflate them:**

**(a) Prod has no hot-reload path.** Every `deploy_data_app` call on a prod (non-draft) config re-clones, re-installs (no cache between deploys), and rebuilds from scratch — genuinely ~20-40s — then you poll `starting` a few times before it's `running`. A draft deployed once in dev mode (`mode='dev'`) avoids this: push a tweak to its branch and the container's `git-watcher` + Vite HMR + `tsx watch` hot-reload in place, no `deploy_data_app` call needed, ~1-3s per tweak instead of ~20-40s. **This is a real option, but only take it if the user wants it** — some explicitly prefer every tweak live on the one real prod URL and find a second draft URL/branch more confusing than the rebuild cost is worth. Ask once, then respect the answer; don't re-relitigate it every time a rebuild feels slow.

**(b) Round-trip/reasoning overhead per tool call — this one bites you on EITHER path (draft or prod).** In a long agent session, each separate tool call costs a full reasoning pass, and those passes get slower as the conversation's accumulated context grows. Doing "edit file → edit file → typecheck → build → git add → git commit → git push" as 6-7 separate tool calls, each with reasoning in between, can add up to minutes of wall-clock time even though every individual command is a few seconds. This is usually the bigger, easier-to-miss cost of the two. **Fix: batch.** Do all the edits, then run typecheck + build + `git add`/`commit`/`push` as one shell invocation. Don't pause to narrate or re-confirm between micro-steps of an already-approved change — save the pause for the actual deploy/run permission gate.
