# Google Group-based access control (on top of OIDC login)

Adds a second authorization layer on top of Keboola's built-in Google OIDC login: OIDC proves
"this is a real company Google account," this pattern additionally restricts WHICH report(s)
that account may see, based on Google Group membership. Built and debugged end-to-end on
Economia's "Subscription Command Center" app (2026-08-20) — every gotcha below cost real time.

## Architecture

- Keboola's `authorization.app_proxy` (configured via the app's Authentication UI, OIDC → Google
  SSO) already gates the whole app on "is this a valid Google login." One shared Google OAuth
  Client (Client ID/Secret) covers ALL apps — add each new app's callback URL
  (`https://<deployment_url>/_proxy/callback`) as an extra Authorized redirect URI on that same
  Client, don't create a new Client per app.
- A small Express middleware (added by you, in `server/index.ts`) reads the logged-in user's
  email from a request header and checks it against a Google Group via the **Cloud Identity
  Groups API** — NOT the Admin SDK Directory API. See §Gotcha 1.
- No domain-wide delegation, no admin-role grant, no impersonation. The service account
  authenticates as itself; it only needs to be added as **Owner or Manager of the target Google
  Group** (a normal Groups membership action anyone with Manager rights on that group can do —
  no Workspace super-admin needed for this part).

## One-time setup (do once per company / GCP project, reuse forever)

1. Google Cloud project already has the Google OAuth Client used for login (ask whoever manages
   Google Workspace SSO for the project name/number — it's the same project the Client ID's
   numeric prefix belongs to, e.g. Client ID `224855598176-xxxx.apps.googleusercontent.com` →
   project number `224855598176`).
2. In that project, enable **Cloud Identity API** (`console.developers.google.com/apis/api/cloudidentity.googleapis.com/overview?project=<project>`).
   This needs someone with access to that Google Cloud project (usually IT/Workspace admin) — you
   likely don't have it yourself. See §Gotcha 4 for the exact error if this step is skipped.
3. Create a dedicated service account in that project (e.g. `keboola-group-check`), download its
   JSON key. This one key is reused across every app.

## Per-Google-Group setup (do once per group, reuse across every app that gates on that group)

1. Create the Google Group if it doesn't exist yet (normal Google Groups UI).
2. Add the service account's email (e.g. `keboola-group-check@<project>.iam.gserviceaccount.com`)
   as **Manager** (Owner also works, Manager is enough — no need to over-grant). Being a Manager
   yourself is sufficient to do this even without being the group's Owner.

## Per-app setup

1. Add the new app's callback URL as an extra Authorized redirect URI on the shared OAuth Client
   (needs whoever manages that Google Cloud project).
2. In Keboola: Authentication → OIDC → Google SSO on the app, using the shared Client ID/Secret.
3. Add the service account JSON as a secret in the app's Advanced Settings → Secrets. **Use the
   env var name `GOOGLE_SERVICE_ACCOUNT_KEY`** (see §Gotcha 2 for why not to invent a new name).
   Paste the ENTIRE JSON file content (not just the `private_key` field) as the value.
4. Add a plain (non-secret is fine, but adding it via the same Secrets UI works too) variable
   **`REQUIRED_GROUP_EMAIL`** = the target group's email, e.g. `dataapps_product@economia.cz`.
5. Copy the middleware below into `server/index.ts`, placed immediately after
   `app.use(express.json(...))` — i.e. before every route, including the Kai chat routes and the
   data endpoints, so the gate protects the API too, not just the HTML shell.
6. Push to `main`, redeploy (needs the app owner's explicit OK — this is a `deploy_data_app` call).

## The middleware

```ts
import { JWT } from 'google-auth-library'; // add "google-auth-library" to package.json deps

function isHealthCheck(req: express.Request): boolean {
  if (req.path === '/api/health') return true;
  if (req.method === 'POST' && req.path === '/') return true;
  if (String(req.headers['user-agent'] || '').startsWith('kube-probe')) return true;
  return false;
}

// Keboola's app-proxy sets its OWN custom header — not a generic oauth2-proxy name.
// Confirmed empirically (2026-08-20): x-kbc-user-email. Fallbacks kept just in case.
const EMAIL_HEADER_CANDIDATES = ['x-kbc-user-email', 'x-forwarded-email', 'x-auth-request-email', 'x-forwarded-user'];

function getUserEmail(req: express.Request): string | null {
  for (const h of EMAIL_HEADER_CANDIDATES) {
    const v = req.headers[h];
    if (typeof v === 'string' && v.includes('@')) return v;
  }
  return null;
}

let groupsClient: JWT | null = null;
function getGroupsClient(): JWT {
  if (groupsClient) return groupsClient;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY secret is not set');
  const key = JSON.parse(raw) as { client_email: string; private_key: string };
  // No `subject` — authenticates as the service account itself. Requires the
  // service account to be Owner/Manager of the group being queried (see setup above).
  groupsClient = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/cloud-identity.groups.readonly'],
  });
  return groupsClient;
}

const groupResourceNameCache = new Map<string, string>();
async function getGroupResourceName(groupEmail: string): Promise<string> {
  const cached = groupResourceNameCache.get(groupEmail);
  if (cached) return cached;
  const client = getGroupsClient();
  const res = await client.request<{ name: string }>({
    url: 'https://cloudidentity.googleapis.com/v1/groups:lookup',
    params: { 'groupKey.id': groupEmail },
  });
  groupResourceNameCache.set(groupEmail, res.data.name);
  return res.data.name;
}

const membershipCache = new Map<string, { isMember: boolean; checkedAt: number }>();
const MEMBERSHIP_CACHE_TTL_MS = 5 * 60 * 1000;
async function isGroupMember(email: string, group: string): Promise<boolean> {
  const cacheKey = `${group}:${email}`;
  const cached = membershipCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < MEMBERSHIP_CACHE_TTL_MS) return cached.isMember;
  const client = getGroupsClient();
  const groupResourceName = await getGroupResourceName(group);
  const res = await client.request<{ hasMembership: boolean }>({
    url: `https://cloudidentity.googleapis.com/v1/${groupResourceName}/memberships:checkTransitiveMembership`,
    params: { query: `member_key_id=='${email}'` },
  });
  const isMember = !!res.data.hasMembership;
  membershipCache.set(cacheKey, { isMember, checkedAt: Date.now() });
  return isMember;
}

function accessDeniedPage(reason: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]!);
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Přístup odepřen</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:96px auto;text-align:center;color:#1a1a2e;">
<div style="font-size:2.5rem;margin-bottom:8px;">🔒</div>
<h1 style="font-size:1.4rem;margin:0 0 12px;">Přístup odepřen</h1>
<p style="color:#666;line-height:1.5;">${esc(reason)}</p>
</body></html>`;
}

// Register this BEFORE any routes (right after express.json()). No-op if REQUIRED_GROUP_EMAIL
// is unset, so this is safe to leave in a shared boilerplate even for apps that don't gate.
app.use(async (req, res, next) => {
  if (isHealthCheck(req)) return next(); // CRITICAL — see Gotcha 3
  const allowedGroup = process.env.REQUIRED_GROUP_EMAIL;
  if (!allowedGroup) return next();
  const email = getUserEmail(req);
  if (!email) {
    res.status(403).send(accessDeniedPage('Nepodařilo se ověřit přihlášeného uživatele. Zkuste se prosím přihlásit znovu.'));
    return;
  }
  try {
    const member = await isGroupMember(email, allowedGroup);
    if (!member) {
      res.status(403).send(accessDeniedPage(`Tento report je dostupný jen pro členy skupiny ${allowedGroup}.`));
      return;
    }
  } catch (err) {
    console.error('[groupAuth] Directory API check failed for', email, ':', err);
    res.status(500).send(accessDeniedPage('Chyba při ověřování přístupu. Zkuste to prosím později.'));
    return;
  }
  next();
});
```

## Gotchas

### 1. Use Cloud Identity Groups API, not Admin SDK Directory API

The "obvious" approach (Admin SDK Directory API + domain-wide delegation, impersonating a
Workspace admin mailbox) works but needs a Workspace super-admin to grant the service account an
admin role, and — worse — needs someone to keep answering "which mailbox does it impersonate,"
which nobody can explain cleanly to IT (expect "why does it need a mailbox?!" pushback). The
Cloud Identity Groups API (`cloudidentity.googleapis.com`, scope
`cloud-identity.groups.readonly`) needs **zero** impersonation: the service account authenticates
as itself and just needs Owner/Manager rights on the specific group, which is a normal Groups
action, not an admin-console action. Confirmed working (Google's own 2020 blog post: "Use
service accounts with Google Groups APIs without domain-wide delegation").

### 2. Custom secret names sometimes silently don't reach the process — root cause unconfirmed

Adding a brand-new secret (even `#`-prefixed, even after renaming) sometimes just doesn't show up
in `process.env` at runtime, even after a full redeploy, with zero error — the app just behaves
as if the variable were unset. Root cause not confirmed (suspected propagation delay on the
Keboola side for newly-added/renamed secrets vs. ones that have existed for a while). **Don't
fight this** — use the exact env var names in the middleware above
(`GOOGLE_SERVICE_ACCOUNT_KEY`, `REQUIRED_GROUP_EMAIL`), which are confirmed to reach the process
reliably. If you must debug a "why is my secret undefined" mystery, add a temporary route that
dumps `Object.keys(process.env).sort()` (names only, never values) — it's the fastest way to see
what's actually there versus what you think you added.

Also note: `mcp__<project>__update_config` is hard-blocked for `keboola.data-apps` components
("cannot be used with keboola.data-apps component. Use modify_python_js_data_app /
modify_streamlit_data_app / deploy_data_app instead") — and none of those dedicated tools expose
a way to set a custom secret. Secrets for these apps currently have to be added by hand through
the Keboola UI (Advanced Settings → Secrets), not via any MCP tool.

### 3. MUST exempt Kubernetes health-check paths from the gate

**Symptom:** deploy fails with `StartupDeadlineExceeded` — "The app container did not become
ready within 10m0s; the app was force-stopped." Startup logs are full of repeating
`[groupAuth] No user email header found` for requests with `user-agent: kube-probe/1.x`.

**Root cause:** Kubernetes' readiness probe hits `GET /api/health` and `POST /` with no auth
headers at all (it's not going through the OIDC login flow). If the gate middleware isn't
exempted for those paths, every probe gets rejected, the container never reports ready, and the
platform force-stops the deploy after 10 minutes. This will happen on your very first deploy with
the gate in place if you forget the exemption — `isHealthCheck()` in the snippet above exists
specifically for this.

### 4. `Cloud Identity API has not been used in project <N> before or it is disabled`

This is a literal, verbatim error string from Google's own API — not a guess. It means step 2 of
the one-time setup (enabling Cloud Identity API in the GCP project) hasn't been done yet, or
hasn't propagated (Google says "wait a few minutes" — in practice a couple of minutes was enough).
The error includes a direct enable link with the project number baked in
(`console.developers.google.com/apis/api/cloudidentity.googleapis.com/overview?project=<N>`) —
just forward that link to whoever manages the GCP project.

### 5. Test with a fresh session/incognito, and beware the Claude-in-browser Electron shell

`Login Failed: Unable to find a valid CSRF token` / `CSRF cookie with name '_oauth2_proxy_csrf'
was not found` is an OIDC-proxy-level cookie problem, unrelated to any app code — it showed up
specifically when testing through the Claude desktop app's embedded Electron browser
(`user-agent` shows `Claude/... Electron/...`), which appears to have less reliable cookie
handling across the OAuth redirect chain than a normal browser. If you hit this, retest in a
normal browser (or a fresh incognito window) before assuming it's a real bug. `<app-url>/_proxy/sign_out`
clears the server-side session if a stale login (wrong test account) is stuck.
