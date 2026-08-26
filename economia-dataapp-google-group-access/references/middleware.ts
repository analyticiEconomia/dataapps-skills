// Google Group access gate for an Economia Keboola JS data app.
// Place this immediately after `app.use(express.json(...))`, before any routes.
// Requires: npm i google-auth-library

import { JWT } from 'google-auth-library';

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
  // service account to be Owner/Manager of the group being queried.
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

// Supports multiple independent groups on the same report (OR logic — member
// of ANY listed group passes) without nesting one group inside another.
// If every single group check errors (e.g. API outage), surface that as an
// error rather than silently treating it as "not a member".
async function isMemberOfAnyGroup(email: string, groups: string[]): Promise<boolean> {
  const results = await Promise.allSettled(groups.map((g) => isGroupMember(email, g)));
  const anyFulfilled = results.some((r) => r.status === 'fulfilled');
  if (!anyFulfilled) {
    const firstRejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw firstRejected ? firstRejected.reason : new Error('All group membership checks failed');
  }
  return results.some((r) => r.status === 'fulfilled' && r.value === true);
}

function accessDeniedPage(reason: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Přístup odepřen</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:96px auto;text-align:center;color:#1a1a2e;">
<div style="font-size:2.5rem;margin-bottom:8px;">🔒</div>
<h1 style="font-size:1.4rem;margin:0 0 12px;">Přístup odepřen</h1>
<p style="color:#666;line-height:1.5;">${esc(reason)}</p>
</body></html>`;
}

// Register this BEFORE any routes (right after express.json()). No-op if REQUIRED_GROUP_EMAIL
// is unset, so this is safe to leave in shared boilerplate even for apps that don't gate.
app.use(async (req, res, next) => {
  if (isHealthCheck(req)) return next(); // CRITICAL — see SKILL.md Gotcha 3
  const allowedGroupsRaw = process.env.REQUIRED_GROUP_EMAIL;
  if (!allowedGroupsRaw) return next();
  // Comma-separated for multi-group access, e.g. "dataapps_product@economia.cz,dataapps_yield@economia.cz"
  const allowedGroups = allowedGroupsRaw.split(',').map((g) => g.trim()).filter(Boolean);
  const email = getUserEmail(req);
  if (!email) {
    res.status(403).send(accessDeniedPage('Nepodařilo se ověřit přihlášeného uživatele. Zkuste se prosím přihlásit znovu.'));
    return;
  }
  try {
    const member = await isMemberOfAnyGroup(email, allowedGroups);
    if (!member) {
      res.status(403).send(accessDeniedPage(`Tento report je dostupný jen pro členy skupiny ${allowedGroups.join(' / ')}.`));
      return;
    }
  } catch (err) {
    console.error('[groupAuth] Directory API check failed for', email, ':', err);
    res.status(500).send(accessDeniedPage('Chyba při ověřování přístupu. Zkuste to prosím později.'));
    return;
  }
  next();
});
