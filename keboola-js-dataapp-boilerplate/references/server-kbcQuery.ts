// Copy this into your app as `server/kbcQuery.ts`.
// Snowflake query wrapper — used by server/index.ts for all `/api/data` calls.
// Reads env at call time (not module load) so a missing var surfaces on the
// failing request instead of crashing the whole Express process at startup.

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
  return { KBC_URL, KBC_TOKEN, BRANCH_ID, WORKSPACE_ID };
}

export type SnowflakeQueryOptions = {
  /**
   * Max rows returned in ONE response page from the results endpoint.
   * NOT a SQL LIMIT — the query itself runs unbounded. Default 500 is too
   * small; pass 50 000+ for real tables. Keboola caps at 100 000.
   */
  pageSize?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type SnowflakeJob = { status: string; statements: { id: string; status: string }[] };
type SnowflakeResults = { columns: { name: string }[]; data: unknown[][] };

const REDACTED_LITERAL = "'[redacted]'";
const REDACTED_NUMBER = '<redacted-number>';

function previewSqlForLog(sql: string) {
  return sql
    .replace(/'(?:''|[^'])*'/g, REDACTED_LITERAL)
    .replace(/\b\d{5,}(?:\.\d+)?\b/g, REDACTED_NUMBER)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export async function runSnowflakeQuery(
  sql: string,
  options: SnowflakeQueryOptions = {},
): Promise<Record<string, unknown>[]> {
  const { KBC_URL, KBC_TOKEN, BRANCH_ID, WORKSPACE_ID } = readEnv();
  const queryHost = KBC_URL.replace('://connection.', '://query.');
  const headers = { 'Content-Type': 'application/json', 'X-StorageAPI-Token': KBC_TOKEN };
  const { signal } = options;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pageSize = Math.min(100_000, Math.max(100, options.pageSize ?? 50_000));

  const submit = await fetch(
    `${queryHost}/api/v1/branches/${BRANCH_ID}/workspaces/${WORKSPACE_ID}/queries`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ statements: [sql], transactional: false }),
      signal,
    },
  );
  if (!submit.ok) throw new Error(`snowflake submit failed: ${submit.status} ${await submit.text()}`);
  const { queryJobId } = (await submit.json()) as { queryJobId: string };

  // Terminal job statuses: "completed" (success), "failed", "canceled".
  // The service never returns "success" — polling for that would hang forever.
  let statementId = '';
  let lastStatus = 'unknown';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    await new Promise((r) => setTimeout(r, 300));
    const statusRes = await fetch(`${queryHost}/api/v1/queries/${queryJobId}`, {
      headers: { 'X-StorageAPI-Token': KBC_TOKEN },
      signal,
    });
    if (!statusRes.ok) {
      throw new Error(`snowflake status poll failed: ${statusRes.status} ${await statusRes.text()}`);
    }
    const job = (await statusRes.json()) as SnowflakeJob;
    lastStatus = job.status;
    if (job.status === 'completed') {
      statementId = job.statements[0].id;
      break;
    }
    if (job.status === 'failed' || job.status === 'canceled') {
      throw new Error(`snowflake query ${job.status}: ${JSON.stringify(job)}`);
    }
  }
  if (!statementId) throw new Error(`snowflake query timed out after ${timeoutMs}ms (last: ${lastStatus})`);

  const resultsRes = await fetch(
    `${queryHost}/api/v1/queries/${queryJobId}/${statementId}/results?offset=0&pageSize=${pageSize}`,
    { headers: { 'X-StorageAPI-Token': KBC_TOKEN }, signal },
  );
  if (!resultsRes.ok) {
    throw new Error(`snowflake results fetch failed: ${resultsRes.status} ${await resultsRes.text()}`);
  }
  const { columns, data } = (await resultsRes.json()) as SnowflakeResults;
  const rows = data.map((row) => Object.fromEntries(columns.map((c, i) => [c.name, row[i]])));
  console.debug(`[kbcQuery] ${rows.length} rows <- ${previewSqlForLog(sql)}`);
  return rows;
}
