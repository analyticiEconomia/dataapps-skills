---
name: economia-dataapp-google-group-access
description: >-
  Add Google SSO login + Google-Group-based report access to an Economia
  Keboola JS data app, after the app itself already exists. Covers where the
  shared credentials live (1Password "Keboola JS Apps Auth"), how to check/
  request the target Google Group from Economia IT, exactly what to add where
  in Keboola (Authentication + Secrets), and the Express middleware that
  enforces it. Use when a new Economia data app needs to be restricted to a
  specific team/group, when asked "jak nastavit Google group access pro
  appku", "kdo smí vidět tenhle report", or when following up on the
  Subscription Command Center pattern for a new app. Companion to
  keboola-js-dataapp-boilerplate/setup (which create the app itself) — this
  skill only covers the auth add-on layer.
metadata:
  version: "1.0.0"
  author: pstepanek
  org: economia
---

# Economia Data App — Google Group Access

**What this adds:** on top of an already-existing Economia Keboola JS data app
(built with `keboola-js-dataapp-boilerplate` or `keboola-js-dataapp-setup`),
this gates the app behind Google SSO login *and* restricts it to members of a
specific Google Group — e.g. only `dataapps_product@economia.cz` can see the
Product report.

**Proven on:** "Subscription Command Center" (config `01ky4g463srtqvevq13y02k753`,
project 753 "00 Distribution"), built 2026-08-12 → 2026-08-20.

## Credentials — where they live

Everything needed for the Google side is in **1Password, entry "Keboola JS
Apps Auth"**:

- Google OAuth **Client ID** + **Client Secret** — shared across every
  Economia data app, used for the login step (OIDC)
- Service account **JSON key** for `keboola-group-check@keboola-sso.iam.gserviceaccount.com`
  — shared across every app, used for the group-membership check

Don't create a new OAuth Client or a new service account per app — reuse
these. If the 1Password entry is missing a field you need, ask Radek
Janovský (Economia IT/Google Workspace contact) rather than provisioning a
new one.

## Per-app checklist

### 1. Pick the target Google Group

Naming convention: `dataapps_<team>@economia.cz` (e.g. `dataapps_product@economia.cz`,
`dataapps_yield@economia.cz`).

### 2. Verify the group exists — if not, request it

Check with Pavel / Google Admin, or just ask in the request below and let IT
confirm. **If the group doesn't exist yet**, email `pocitace@economia.cz`
using section A of the template in `references/group-request-email.md` —
model it on the existing `Dataapps Product` group:

- Group email: `dataapps_<team>@economia.cz`
- Description: "Skupina/Ověření pro google ověření přihlášení do reportů"
- Managers/Admins to add at creation time:
  - `pavel.stepanek@economia.cz`
  - `martin.sedlacek@economia.cz`
  - `vit.svoboda@economia.cz`
  - `analytici@economia.cz` (analytics team alias)
  - `keboola-group-check@keboola-sso.iam.gserviceaccount.com` — **required**,
    this is what lets the app's middleware query membership without any
    Workspace admin role or impersonation (Cloud Identity Groups API, see
    Gotcha 1 below)
- Say explicitly that the rest of the actual report viewers will be added by
  us afterwards — IT only needs to stand the group up with those admins.

If the group already exists, just confirm the service account is a
Manager/Owner on it (Google Groups UI → group → Members) — that's the only
Google-side action needed per group.

### 3. Add the app's callback URL to the shared OAuth Client

**This is NOT a Google Groups action** — don't look for it on
`groups.google.com`. It's a completely separate Google system: the **OAuth
Client itself**, which lives in **Google Cloud Console**
(`console.cloud.google.com`), on the GCP project that owns the Client ID from
1Password:

**APIs & Services → Credentials → (the shared OAuth Client) → Authorized
redirect URIs → add**:

```
https://<deployment_url>/_proxy/callback
```

e.g. for Subscription Command Center:
`https://subscription-command-center-985851361.hub.eu-central-1.keboola.com/_proxy/callback`
(the deployment URL is the app's own Keboola-assigned hostname, not anything
Google-related).

Don't create a new Client — add the URI to the existing shared one. This
needs whoever has access to that specific GCP project — in practice, Radek —
same as enabling the Cloud Identity API (Gotcha 4). Google Groups membership
(step 2, on `groups.google.com`) and this OAuth Client redirect-URI list are
unrelated systems; don't conflate them.

If both step 2 (new group) and this step are needed for the same app, send
one combined email to Radek — `references/group-request-email.md` has both
asks as separate sections (A = group, B = redirect URI); include whichever
section(s) apply.

### 4. Configure Google SSO on the app in Keboola

Keboola UI → the app → **Authentication → OIDC → Google SSO** → paste the
Client ID and Client Secret from the 1Password entry.

### 5. Add secrets/variables in Advanced Settings → Secrets

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the **entire** service account JSON file content (not just `private_key`), from 1Password |
| `REQUIRED_GROUP_EMAIL` | the target group's email, e.g. `dataapps_product@economia.cz` |

Use exactly these two names — see Gotcha 2. Note: these have to be added by
hand through the Keboola UI; `update_config` via MCP is hard-blocked for
`keboola.data-apps` components and none of the dedicated data-app MCP tools
expose a secrets field.

> ⚠️ The Subscription Command Center build (2026-08-20) at one point used
> different names (`#GOOGLE_SERVICE_ACCOUNT_JSON` / `ALLOWED_GROUP`) before
> settling on the pair above — if you're touching that specific app rather
> than building a new one, check its actual current secrets/variables in the
> Keboola UI before assuming which pair it ended up on.

### 6. Add the middleware to the app's code

Copy `references/middleware.ts` into `server/index.ts`, placed **immediately
after** `app.use(express.json(...))` — before every route, including Kai
chat routes and data endpoints, so the gate protects the API too. Add
`"google-auth-library"` to `package.json` dependencies.

### 7. Ship

```bash
git add -A
git commit -m "Add Google Group access gate"
git push origin main
```

Deploy needs the app owner's explicit "spusť" per standing rule — this
pushes new code but doesn't redeploy the running container by itself (Keboola
picks it up on next container start / manual redeploy).

### 8. Test

Use a fresh browser session or incognito window — **not** an embedded
Electron browser (e.g. Claude desktop's preview) — see Gotcha 5.

## Gotchas

### 1. Cloud Identity Groups API, not Admin SDK Directory API

The service account authenticates as itself and only needs Owner/Manager
rights on the specific group — no domain-wide delegation, no Workspace
admin-role grant, no impersonation. Confirmed via Google's own guidance
("Use service accounts with Google Groups APIs without domain-wide
delegation"). This is why the group-creation request in step 2 asks IT to
add the service account as a Manager directly, instead of asking for any
admin role.

### 2. Custom secret names sometimes silently don't reach the process

A newly-added or renamed secret can just not show up in `process.env` at
runtime with zero error, even after a full redeploy (suspected propagation
delay on Keboola's side). Stick to the confirmed-working names
`GOOGLE_SERVICE_ACCOUNT_KEY` / `REQUIRED_GROUP_EMAIL`. If a secret seems to
vanish, add a temporary route dumping `Object.keys(process.env).sort()`
(names only) to see what actually reached the container.

### 3. MUST exempt Kubernetes health-check paths from the gate

**Symptom:** deploy fails with `StartupDeadlineExceeded` after 10 minutes,
logs full of `[groupAuth] No user email header found` for
`user-agent: kube-probe/*`. Kubernetes' readiness probe hits `GET /api/health`
and `POST /` with no auth headers — it never goes through the OIDC flow. The
`isHealthCheck()` check in the middleware exists specifically to exempt
these paths; don't remove it.

### 4. `Cloud Identity API has not been used in project <N> before or it is disabled`

Verbatim Google error — means Cloud Identity API isn't enabled yet on the GCP
project that owns the service account. The error includes a direct enable
link with the project number baked in; forward it to whoever manages that
GCP project. Takes a couple of minutes to propagate after enabling.

### 5. Test with a fresh session, and beware the Claude-in-browser Electron shell

`Login Failed: Unable to find a valid CSRF token` / missing
`_oauth2_proxy_csrf` cookie is an OIDC-proxy cookie problem, not an app bug —
seen specifically inside the Claude desktop app's embedded Electron browser,
which handles cookies across the OAuth redirect chain less reliably than a
normal browser. Retest in a normal browser/incognito before assuming it's
real. `<app-url>/_proxy/sign_out` clears a stuck stale login.

## Handy links

- Cloud Identity Groups API enable link pattern: `console.developers.google.com/apis/api/cloudidentity.googleapis.com/overview?project=<N>`
- Companion skills: `keboola-js-dataapp-boilerplate` (build the app), `keboola-js-dataapp-design` (visual system)
