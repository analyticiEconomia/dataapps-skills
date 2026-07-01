---
name: keboola-js-dataapp-boilerplate
description: Complete recipe for building a Keboola JS data app the way that actually works — React + Vite + TypeScript frontend, Express server with Snowflake queries, Kai chat integration via polling (not SSE — that fails in the Keboola ingress). Hosted on a Keboola-managed git repo (git.<region>.keboola.com), auto-deploys on push to main. Bakes in every pitfall from prior builds (Kai 403/404/branchId/SSE drop, Snowflake pageSize truncation, epoch timestamp conversion, transformation LIMIT truncation, UUID case folds, ERP integration counts). Trigger phrases — "new Keboola JS data app", "build a data app with React", "add Kai chat to a JS data app", "why is my data app showing exactly 10 000 rows", "why does Ask Kai drop mid-response". Companion skill — `keboola-js-dataapp-design` for the visual system.
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
- `references/server-kbcQuery.ts` — Snowflake query wrapper (correct pageSize)
- `references/AskKaiPage.tsx` — polling chat client with SSE parser + icon post-processor
- `references/package.json` — deps + build scripts
- `references/keboola-config/` — nginx + supervisord configs
- `references/data-flow.md` — Snowflake pre-agg table pattern
- `references/pitfalls.md` — every rake we stepped on; read before shipping

## The workflow

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

Keboola pulls the code on next container start. **A push does not auto-restart a running container** — the current container serves cached code until it hits the 15-min auto-suspend timeout, or until you click Redeploy in the UI. See `references/pitfalls.md` §14.

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
