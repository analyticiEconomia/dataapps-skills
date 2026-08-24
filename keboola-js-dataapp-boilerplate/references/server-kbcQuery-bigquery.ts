// BigQuery (and any-backend) query helper — the WORKSPACE QUERY endpoint.
//
// Use THIS instead of `server-kbcQuery.ts` (the Snowflake Query Service helper)
// when:
//   - the project's SQL dialect is BigQuery, OR
//   - you are porting a Streamlit app whose injected `query_data()` already used
//     this endpoint (it is backend-agnostic and works for Snowflake too).
//
// Endpoint (same one Keboola injects into Streamlit's query_data):
//   POST {KBC_URL}/v2/storage/branch/{BRANCH_ID}/workspaces/{WORKSPACE_ID}/query
//   body: { "query": "<sql>" }   ->   { "data": { "rows": [ {col: val, ...} ] } }
//
// Rows come back as objects keyed by column name (NOT [columns]+[data] arrays
// like the Snowflake service), so no column-zipping is needed. Cells may still
// arrive as strings — coerce numbers/dates on read.
//
// Required env (identical to Streamlit's query_data): KBC_URL, KBC_TOKEN,
// BRANCH_ID, WORKSPACE_ID. KBC_URL + KBC_TOKEN are auto-injected into the data
// app; BRANCH_ID + WORKSPACE_ID often are NOT — set them as Secrets (mirror the
// original Streamlit app's secrets). KBC_TOKEN is workspace-scoped, which is
// exactly what this endpoint wants.

function readEnv() {
  const KBC_URL = process.env.KBC_URL;
  const KBC_TOKEN = process.env.KBC_TOKEN;
  const BRANCH_ID = process.env.BRANCH_ID;
  const WORKSPACE_ID = process.env.WORKSPACE_ID;
  if (!KBC_URL || !KBC_TOKEN || !BRANCH_ID || !WORKSPACE_ID) {
    const missing = [
      ['KBC_URL', KBC_URL],
      ['KBC_TOKEN', KBC_TOKEN],
      ['BRANCH_ID', BRANCH_ID],
      ['WORKSPACE_ID', WORKSPACE_ID],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);
    throw new Error(`kbcQuery: missing env vars: ${missing.join(', ')}`);
  }
  return { KBC_URL: KBC_URL.replace(/\/$/, ''), KBC_TOKEN, BRANCH_ID, WORKSPACE_ID };
}

type QueryResponse = {
  status?: string;
  message?: string;
  data?: { rows?: Record<string, unknown>[] };
};

// Optional TTL cache, keyed by the exact SQL. Mirrors @st.cache_data(ttl=3600).
// For a DYNAMIC-FILTER app this is important: many small parameterised queries
// repeat as users flip between tabs, and each cache hit is a free round-trip.
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; rows: Record<string, unknown>[] }>();

export async function runQuery(
  sql: string,
  opts: { cache?: boolean; timeoutMs?: number } = {},
): Promise<Record<string, unknown>[]> {
  const useCache = opts.cache !== false;
  if (useCache) {
    const hit = cache.get(sql);
    if (hit && Date.now() - hit.at <= CACHE_TTL_MS) return hit.rows;
    if (hit) cache.delete(sql);
  }

  const { KBC_URL, KBC_TOKEN, BRANCH_ID, WORKSPACE_ID } = readEnv();
  const url = `${KBC_URL}/v2/storage/branch/${BRANCH_ID}/workspaces/${WORKSPACE_ID}/query`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // storage tokens use X-StorageAPI-Token; bearer tokens use Authorization.
        ...(KBC_TOKEN.startsWith('Bearer ')
          ? { Authorization: KBC_TOKEN }
          : { 'X-StorageAPI-Token': KBC_TOKEN }),
      },
      body: JSON.stringify({ query: sql }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`workspace query failed: ${res.status} ${await res.text().catch(() => '')}`);
  const json = (await res.json()) as QueryResponse;
  if (json.status === 'error') throw new Error(`query error: ${json.message ?? 'unknown'}`);
  const rows = json.data?.rows ?? [];
  if (useCache) cache.set(sql, { at: Date.now(), rows });
  return rows;
}
