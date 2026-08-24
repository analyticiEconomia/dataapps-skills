---
name: keboola-js-dataapp-boilerplate
description: >-
  Complete recipe for building a Keboola JS data app that actually works — React + Vite + TypeScript frontend, Express server querying Snowflake (Query Service) or BigQuery (workspace-query endpoint), Kai chat via polling (not SSE — it drops in the Keboola ingress). Covers both the read-once pre-aggregated model and dynamic per-filter query apps (the shape you get porting a Streamlit dashboard), on a Keboola-managed git repo that auto-deploys on push to main. Also covers restricting an app (or specific reports within it) to members of a Google Group on top of standard Google OIDC login, via the Cloud Identity Groups API (no domain-wide delegation/impersonation needed). Bakes in the pitfalls — Kai 403/404/branchId/SSE drop, pageSize truncation, epoch timestamps, transformation LIMIT truncation, UUID case folds, 431 from filters in a GET query string, esbuild not type-checking, StartupDeadlineExceeded from an unexempted health-check path. Trigger phrases — "new Keboola JS data app", "build a data app with React", "port my Streamlit app to JS", "add Kai chat to a JS data app", "why is my data app showing exactly 10 000 rows", "why does my filter request 431", "restrict this report to a Google Group", "only let X group see this app". Companion skill — keboola-js-dataapp-design for the visual system.
metadata:
  version: "1.0.0"
  author: pstepanek
---

# Keboola JS Data App — Boilerplate

**What this produces:** a React + Vite + TypeScript SPA served by Express, hosted on a Keboola-managed git repository. Push to `main` auto-triggers a redeploy inside Keboola. Data comes from Snowflake pre-aggregated tables. Ask Kai chat works reliably.

**What this is NOT for:** standalone browser-only maps or 3D scenes deployed via GitHub Actions to an external repo. Use `keboola-js-dataapp-setup` for that older pattern.

## Companion skills

- **`keboola-js-dataapp-design`** — visual system (Classic tabs + Story mode), chart "how to read" explainers, required Docs and Ask Kai tabs. Always invoke together with this one when building a new app.
- **`keboola-storage-query`** — SQL patterns for `query_data` MCP.
- **`keboola-dataapp-add-feedback`** — Google Chat feedback button.

## The seven files that matter

```
/
├── package.json                       # deps + scripts
├── tsconfig.json / tsconfig.server.json
├── vite.config.ts                     # dev server + build
├── keboola-config/                    # copied by Keboola container at start
│   ├── nginx/sites/default.conf       # ingress → :3000 / :3100 routing
│   ├── setup.sh / setup-dev.sh        # npm install
│   └── supervisord*/services/*.conf   # process manager (Express :3000 prod, Vite :3000 + Express :3100 dev)
├── server/
│   ├── index.ts                       # Express — /api/data/all, /api/chat/*
│   └── kbcQuery.ts                    # Snowflake query wrapper
└── src/
    ├── main.tsx
    ├── App.tsx                        # router + mode selector
    ├── StoryPage.tsx                  # (see design skill)
    ├── index.css                      # design tokens (see design skill)
    └── hooks/useFetch.ts
```

Ready-to-copy templates live in `references/`:
- `references/server-index.ts` — full Express server with Kai polling, Snowflake helper, health check
- `references/server-kbcQuery.ts` — **Snowflake** query wrapper (Query Service, correct pageSize)
- `references/server-kbcQuery-bigquery.ts` — **BigQuery / any-backend** query wrapper (the workspace-query endpoint). Use this when the project dialect is BigQuery, or when porting a Streamlit app whose `query_data()` used `/v2/storage/branch/{b}/workspaces/{w}/query`. Pick ONE of the two helpers.
- `references/AskKaiPage.tsx` — polling chat client with SSE parser + icon post-processor
- `references/package.json` — deps + build scripts
- `references/keboola-config/` — nginx + supervisord configs
- `references/data-flow.md` — Snowflake pre-agg table pattern
- `references/pitfalls.md` — every rake we stepped on; read before shipping
- `references/google-group-access.md` — optional add-on: gate the app (or specific
  reports/tabs within it) by Google Group membership on top of the standard OIDC login.
  Full middleware snippet + every gotcha from a real end-to-end build.

## Two data-access architectures — pick before you build the server

1. **Read-once pre-agg (default).** The app loads a handful of small ready-made tables once via `/api/data/all`; all interactivity happens client-side on already-loaded data. Best when the whole dataset the app needs fits in a few small `SELECT *`s. This is what `data-flow.md` and the `/api/data/all` template describe.

2. **Dynamic per-filter queries.** The app has filters (date range, country, category cascade, free-text) and must query on demand — the underlying tables are too big to ship whole. The server exposes **parameterised endpoints** (`/api/dimensions`, `/api/<tab>`…), each building SQL from the request and running it through the query helper, with the helper's TTL cache doing the work `@st.cache_data` did in Streamlit. Ported Streamlit apps are almost always this kind.

For architecture 2: keep ALL SQL server-side (never build SQL in the browser), reuse the source app's escaping helpers verbatim (`sqlStr`/`sqlIn`/`escLike`), send filters via **POST** with fully-selected dimensions compacted to `null` (see `pitfalls.md` §25), and fetch each tab's data lazily when that tab mounts (React renders only the active tab — this is the main cold-start win over Streamlit, which re-runs every tab's queries on every load).

## Porting an existing Streamlit data app

1. `get_data_apps(configuration_ids=[<cfg>])` → extract `parameters.script` (the `.py`), `packages`, `runtime.backend.size`, `authorization`, and secrets. The detail can exceed the tool token limit — see `pitfalls.md` §27 for the file-extract trick.
2. Note the project dialect (`get_project_info`) → choose the Snowflake or BigQuery query helper.
3. Port each Streamlit tab's SQL into a server function 1:1, keeping the same table names, filters, and "last full week"/date logic. Return plain data; do formatting/charting in React.
4. Create the app in the SAME project so its workspace can already read the source buckets. Verify one endpoint against live data before building all the tabs — a 5-line smoke test (start the built server with real env, `curl /api/<tab>`) catches token/workspace/dialect problems immediately.

## The workflow

> **Deploy strategy — straight to production (recommended):** unless your team requires a review gate, deploy **straight to production** and skip the draft → dev-preview → approve → merge dance. The dev-preview draft sits behind basic-auth on a separate URL and is awkward to view, so it usually adds friction with no value. For a new app: create the prod app, clone its managed repo, push code to `main`, `deploy_data_app(configuration_id=PROD)` (no `mode`). For edits: push `main`, redeploy prod. (Always get the app owner's explicit OK before running a deploy.)

> **Multi-round sessions (design reviews, copy tweaks, "walk through each tab together") feel slow for two separate reasons — don't conflate them:**
>
> 1. **The prod rebuild itself** (~20-40s: git clone → `npm install`, no cache between deploys → `vite build` → `tsc` → container restart) is real and, if iterating straight against prod, unavoidable per push. A draft deployed in dev mode (`deploy_data_app(mode='dev')` once, then just `git push` to its branch for every follow-up tweak — its `git-watcher` + Vite HMR hot-reload without another `deploy_data_app` call) avoids this cost entirely. **But this is an offer, not a default** — some users specifically want every tweak live on the real prod URL, not a separate draft link, and explicitly asked to skip the draft dance entirely (it adds a second URL/branch to track, which was its own source of confusion in practice). Ask once which the user/team prefers; don't re-propose the draft flow every time you feel the rebuild cost — if they said "always straight to prod," that stands until they say otherwise.
> 2. **The bigger, easy-to-miss cost in a long agent session is round-trip overhead**, not raw command time: each separate tool call costs a full reasoning pass, and that pass gets slower as the conversation's context grows over a long session — so 5 tiny sequential steps (edit → edit → typecheck → build → git add/commit/push, each its own tool call with reasoning in between) can add up to minutes even though every individual command only takes a few seconds. This applies **regardless** of draft vs. prod. The fix: batch aggressively. Do the edit(s), then run typecheck + build + `git add` + `commit` + `push` as **one** shell invocation, not five. Don't stop to narrate or ask for confirmation between each micro-step of a single already-approved change — save the pause for the one gate that actually needs it (the deploy/run permission itself).

### Step 1 — Provision the data app in Keboola

Use `mcp__<project>__create_config` (or `create_python_js_data_app_git_credential`) to create the data app configuration:

- Component: `keboola.data-apps`
- Type: `python-js`
- `slug`: kebab-case, appears in the deployment URL
- `runtime.workspace.enabled`: `true` (required for Snowflake queries from the container)
- `authorization.app_proxy.auth_rules`: `[{type: "pathPrefix", value: "/", auth_required: false}]` for public apps

Result: Keboola provisions a private git repo at `git.<region>.keboola.com/keboola/app-<data_app_id>.git` and returns credentials. Save the credentials — you'll use them for `git clone`.

### Step 2 — Clone and scaffold

```bash
git clone https://<username>:<password>@git.<region>.keboola.com/keboola/app-<id>.git
cd app-<id>
```

Copy every file from `references/` into place. Run `npm install`. `npm run build` should succeed on an empty scaffold before you touch anything else.

### Step 3 — Add the STORAGE_API_TOKEN secret

**Do this BEFORE writing Kai code.** In the Keboola UI:

1. **Settings → API Tokens → + New Token** — name it after the app, permissions **Full Access**, copy the token (shown once)
2. **Data Apps → your app → Advanced Settings → Secrets → + Add Secret** — Name: `STORAGE_API_TOKEN`, Value: paste

Why: the auto-injected `KBC_TOKEN` is scoped to the app's own workspace and returns 403 against tenant-wide `kai-assistant`. Only a Full Access token can talk to Kai. See `references/pitfalls.md` §2.

### Step 4 — Build your pre-aggregation transformation

Any real data app is fed by one or more Snowflake transformations that produce `ACC_*` (or similar) pre-aggregated tables. The data app queries those tables directly — no per-request aggregation. Rules:

- **One KPI table with a single row** carries all headline counts. The frontend reads counts from KPIs, not from `table.length` of detail tables. `LIMIT N` on detail tables is common; using `.length` produces silent truncation.
- **Distribution/histogram tables** must be produced by their own `GROUP BY` block, not derived from a `LIMIT`ed detail table (or the distribution will be skewed toward whatever the ORDER BY prioritized).
- **Add explicit output mapping** in `storage.output.tables` for every table you `CREATE OR REPLACE`. Tables that only exist in the workspace never appear in Storage.

See `references/data-flow.md` for the full pre-agg pattern and `references/pitfalls.md` §7, §16.

### Step 5 — Wire the data app to the tables

In `server/index.ts`, add each pre-agg table to the parallel `queryTable(...)` fan-out and mirror it in the JSON response. In `src/App.tsx`, extend the `DataResponse` interface to match. `useFetch` in `hooks/` handles the request + loading/error state.

### Step 6 — Design pass

Now (not before) apply `keboola-js-dataapp-design`:
- Add landing mode selector (Classic vs Story) with `localStorage` persistence
- First tab: `Documentation` (mandatory)
- Last tab: `Ask Kai` (mandatory)
- Every chart wrapped in `<ChartExplainer>` — "how to read" + "where the number comes from" (plain language, not SQL)

### Step 7 — Ship

```bash
git add -A
git commit -m "Initial release"
git push origin main
```

Keboola pulls the code on next container start. **A push does not auto-restart a running container** — the current container serves cached code until it hits the auto-suspend timeout (default `autoSuspendAfterSeconds: 300`, 5 minutes — confirm in the app's Advanced Settings, don't assume 15 min), or until you click Redeploy in the UI. See `references/pitfalls.md` §14.

## Pre-flight checklist

Before opening a PR / calling the app finished:

- [ ] `STORAGE_API_TOKEN` secret set in Advanced Settings (Kai without it → 500 with instructional error)
- [ ] Every pre-agg table exists in `storage.output.tables` (workspace-only tables silently disappear)
- [ ] Every table with hero-KPI-count usage has that count exposed as a KPI column, NOT computed from `table.length`
- [ ] Every `LIMIT N` in transformation SQL is documented in `data-flow.md` — and if the true count matters, a `COUNT(*)` column exists in the KPI row
- [ ] `pageSize` in `queryTable` is at least 50 000 (default 10 000 silently truncates larger tables)
- [ ] `snapshotAt` is converted from Unix epoch **seconds** to ISO string on the server
- [ ] Kai chat: polling flow (`/api/chat/start` + `/api/chat/poll`), not SSE
- [ ] First-tab Documentation + last-tab Ask Kai present
- [ ] `npm run build` clean, no TypeScript errors
- [ ] Local dev works (`npm run dev` on Windows: two terminals, one `npm run dev` for Vite :3000, one `tsx watch server/index.ts` for Express :3100)

## Handy links

- Kai client source (Python reference for the API shape): https://github.com/keboola/kai-client
- Keboola data apps docs: https://help.keboola.com/components/data-apps/
