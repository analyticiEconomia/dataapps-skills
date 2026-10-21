---
name: economia-dataapp-google-group-access
description: >-
  Add Google SSO login + Google-Group-based report access to an Economia
  Keboola data app (JS/Express or Python/Flask), after the app itself already
  exists. Covers where the shared credentials live (1Password "Keboola JS
  Apps Auth"), how to check/request the target Google Group from Economia IT,
  exactly what to add where in Keboola (Authentication + Secrets), and the
  middleware that enforces it — Express (`references/middleware.ts`) or Flask
  (`references/group_auth.py`). Use when a new Economia data app needs to be
  restricted to a specific team/group, when asked "jak nastavit Google group
  access pro appku", "kdo smí vidět tenhle report", or when following up on
  the Subscription Command Center / Traffic report patterns for a new app.
  Companion to keboola-js-dataapp-boilerplate/setup (which create the app
  itself) — this skill only covers the auth add-on layer.
metadata:
  version: "1.2.0"
  author: pstepanek
  org: economia
---

# Economia Data App — Google Group Access

**What this adds:** on top of an already-existing Economia Keboola JS data app
(built with `keboola-js-dataapp-boilerplate` or `keboola-js-dataapp-setup`),
this gates the app behind Google SSO login *and* restricts it to members of a
specific Google Group — e.g. only `dataapps_product@economia.cz` can see the
Product report.

**Proven on:**
- "Subscription Command Center" (JS/Express, config `01ky4g463srtqvevq13y02k753`,
  project 753 "00 Distribution"), built 2026-08-12 → 2026-08-20; access-denied
  contact line fixed 2026-09-30 (see step 6, Gotcha 7).
- "Traffic report" (Python/Flask, config `01m22m2xg5kg6f1yj3r5k3dn9g`, data
  app id `985851973`, project 757), fixed 2026-09-16 — see Gotcha 6. Note: as
  of 2026-09-30 this app's `REQUIRED_GROUP_EMAIL`/auth is unset again
  (`auth_required: false`) — check current state before assuming it's still
  gated.
- "Yield Reports" (JS/Express, config `01m3rrha312nvcxp6fz9d0hwfk`, project
  708 "00 Yield") — live gate on `dataapps_yield@economia.cz`; contact line
  added 2026-09-30.
- "Mediakit" (project 757) has OIDC but **not** a working group gate — see
  Gotcha 8, not yet fixed.

**Two stacks, same pattern.** Economia data apps come in two shapes: JS
(React + Vite + Express, `keboola-js-dataapp-boilerplate`) and Python/Flask +
gunicorn (`app.py`, `pyproject.toml`, no Node at all). The Keboola-side setup
(steps 1–5, 7, 8 below) is identical either way — only step 6 (which
middleware file to copy in, and which dependency to declare) differs. Check
which stack an app uses before following step 6: a `package.json` at the repo
root means JS/Express (`references/middleware.ts`); a `pyproject.toml` /
`app.py` means Python/Flask (`references/group_auth.py`).

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
| `REQUIRED_GROUP_EMAIL` | the target group's email, e.g. `dataapps_product@economia.cz`. For more than one group, comma-separate them — see "Multiple groups on one report" below |

Use exactly these two names — see Gotcha 2. Note: these have to be added by
hand through the Keboola UI; `update_config` via MCP is hard-blocked for
`keboola.data-apps` components and none of the dedicated data-app MCP tools
expose a secrets field.

> ⚠️ The Subscription Command Center build (2026-08-20) at one point used
> different names (`#GOOGLE_SERVICE_ACCOUNT_JSON` / `ALLOWED_GROUP`) before
> settling on the pair above — if you're touching that specific app rather
> than building a new one, check its actual current secrets/variables in the
> Keboola UI before assuming which pair it ended up on.

### 6. Add the middleware/gate to the app's code

**Access-denied page contact line.** Both reference templates end the
"you're not in the group" message with `Pokud si myslíte, že byste přístup
mít měli, napište na vit.svoboda@economia.cz nebo pavel.stepanek@economia.cz.`
— Vít and Pavel are the standing contacts for access requests on gated
reports. Keep this exact pair whenever you touch a denied-page string; don't
revert to a generic "kontaktujte administrátora" (that's what Subscription
Command Center originally shipped with, fixed 2026-09-30).

**JS/Express apps:** copy `references/middleware.ts` into `server/index.ts`,
placed **immediately after** `app.use(express.json(...))` — before every
route, including Kai chat routes and data endpoints, so the gate protects the
API too. Add `"google-auth-library"` to `package.json` dependencies.

**Python/Flask apps:** copy `references/group_auth.py` into the app root and
register it as a `before_request` hook in `app.py`, **before any route
definitions**:

```python
from group_auth import check_group_access

@app.before_request
def _group_access_gate():
    return check_group_access()
```

Add both `"google-auth>=2.30.0"` **and** `"requests>=2.31.0"` to
`pyproject.toml` `dependencies` — see Gotcha 6, this is the one step that's
easy to get wrong porting the JS version by hand.

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

## Multiple groups on one report

Need e.g. both `dataapps_product@economia.cz` and `dataapps_yield@economia.cz`
to see the same report, without creating a merged group for it? Two options:

**A) Multi-group env var (recommended default).** Set `REQUIRED_GROUP_EMAIL`
to a comma-separated list:

```
dataapps_product@economia.cz,dataapps_yield@economia.cz
```

`references/middleware.ts` already implements this — `isMemberOfAnyGroup()`
checks every listed group and passes if the user is a member of **any one**
of them. The two groups stay fully independent; this only affects this one
app. Preferred whenever the groups should keep meaning different things
elsewhere.

**B) Nest one group inside the other (zero code change).** In Google Groups,
add one existing group as a *member* of the other (e.g. add
`dataapps_yield@economia.cz` as a member of `dataapps_product@economia.cz`).
Because the middleware calls `checkTransitiveMembership`, nested membership
resolves automatically — no env var or code change needed on the app.
**Caveat:** this permanently merges the two groups' access everywhere they're
each already used to gate other reports, not just this one — e.g. if
`dataapps_product` also gates a different, Product-only report, Yield members
now see that one too. Only do this if that side effect is actually fine (or
the two groups aren't used to gate anything else).

Default to (A) unless you specifically want the groups permanently merged.

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

### 6. Python/Flask: missing `requests` dependency silently breaks the whole app, not just the gate

**Symptom:** app looks "fine" from the outside (`state: running` in Keboola,
reachable URL) but the group gate never actually blocks anyone — including
emails that were just removed from the group. No error visible anywhere
convenient.

**Root cause:** `google.auth.transport.requests.AuthorizedSession` (used in
`references/group_auth.py`) needs the `requests` package installed
separately — unlike the JS `google-auth-library`, which bundles its own HTTP
transport and needs no extra dependency. If `pyproject.toml` only lists
`google-auth` and not `requests`, importing `group_auth` raises
`ImportError: The requests library is not installed...`. Since `app.py`
imports `group_auth` at module level, the **entire app** fails to boot — not
just the gate. The container's gunicorn worker crashes and retries a few
times, then gives up (`FATAL`, "too many start retries too quickly").

**Why it looks like it's "working":** Keboola appears to keep serving the
last successfully-running container when a new deploy's container fails to
boot, instead of surfacing a hard failure. So the app stays reachable and
`state: running` — but it's silently the *previous* deployed version, which
in this case predated the group-access gate entirely. Anyone could log in
regardless of group membership, because the code doing the check was never
actually live.

**Fix:** add `"requests>=2.31.0"` to `pyproject.toml` alongside `google-auth`
(see step 6 above), commit, push, then explicitly redeploy — a `git push`
alone does not restart the running container.

**Diagnosis path if this happens again:** check the raw container startup
logs (not just `state`) for an `ImportError` traceback around `group_auth`
import; a `last_run` stuck in `"starting"` with no `failure_reason` is also a
tell that a redeploy attempt is failing to boot while an older container
keeps answering requests.

### 7. The Keboola-configured "deploy branch" can differ from the repo's default branch

Subscription Command Center's Keboola config (`parameters.dataApp.git.branch`)
says `main`, but `git clone` without a branch arg checked out `init` — a
different, older branch that is the repo's actual `HEAD`/default. The real,
currently-deployed code lives on `main`; `init` looks similar but is stale.
Always check the app's config for the configured branch name and explicitly
`git fetch origin <that-branch> && git checkout <that-branch>` — don't trust
`git clone`'s default checkout. Found 2026-09-30 while patching the
access-denied contact line.

### 8. Mediakit has OIDC login but no working group-membership check

Mediakit (config `01m3rh0x2aq0sm2q4h3z8xzw1h`, project 757) has
`auth_required: true` with Google OIDC configured, and a secret that looks
like it was meant to hold the service-account JSON — but the secret *name*
itself is the mangled JSON content (e.g. starts
`#TYPE_SERVICE_ACCOUNT___PROJECT_ID_KEBOOLA_SSO___PRIVATE_KEY_ID_...`), not
`GOOGLE_SERVICE_ACCOUNT_KEY`, and there is no `group_auth.py` /
`before_request` gate anywhere in the app's repo at all. Net effect: any
Google account can log in, no group restriction actually applies, despite
the app looking gated. Not fixed as part of the 2026-09-30 contact-line pass
(out of scope — flagging for a follow-up: redo step 5 + step 6 properly on
this app).

### 9. Nested groups need the service account's permission on EVERY level, not just the top group

**Symptom:** app shows the 500 "Chyba při ověřování přístupu. Zkuste to
prosím později." page for everyone (not the 403 "not a member" page), even
for users who should be in the allowed group. Logs show a 403 from
`cloudidentity.googleapis.com` on `memberships:checkTransitiveMembership`:

```
Error(2028): Permission denied for resource <nested-group>@economia.cz (or it may not exist).
```

Seen 2026-10-01 on Subscription Command Center: `ALLOWED_GROUP` is
`dataapps_product@economia.cz`, but that group has `analyticky.tym@economia.cz`
nested as a member. `checkTransitiveMembership` has to walk into every nested
group to resolve the chain, and the service account was only ever granted
Manager on the top-level group (per step 2) — not on the group nested inside
it. Google Cloud Identity Groups API requires the caller to have read access
on each group in the transitive chain, so the walk 403s as soon as it hits
the unauthorized nested group, even though the service account's own
top-level membership is fine.

**Fix:** grant `keboola-group-check@keboola-sso.iam.gserviceaccount.com`
Manager (or Member, Viewer may not be enough — test) on the nested group too
— here, `analyticky.tym@economia.cz`. If `ALLOWED_GROUP`/`REQUIRED_GROUP_EMAIL`
nests other groups, every one of them needs the same grant. Ask whoever owns
Google Groups admin (Radek) which groups are nested before assuming a
single-group fix is enough.

## Handy links

- Cloud Identity Groups API enable link pattern: `console.developers.google.com/apis/api/cloudidentity.googleapis.com/overview?project=<N>`
- Companion skills: `keboola-js-dataapp-boilerplate` (build the app), `keboola-js-dataapp-design` (visual system)
