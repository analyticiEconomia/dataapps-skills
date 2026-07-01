// Copy this into your app as `server/index.ts`.
// It contains: Kai discovery, Kai polling proxy (start + poll), health check,
// SPA static serve + fallback, and a placeholder /api/data/all with a
// `queryTable()` helper. Extend `queryTable(...)` calls for your own tables.
//
// Companion file: `server/kbcQuery.ts` (Snowflake wrapper).

import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { runSnowflakeQuery } from './kbcQuery';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production';
const clientDir = path.join(__dirname, '..', 'client');

app.use(express.json({ limit: '1mb' }));

// ============================================================================
// Kai chat: buffered stream + client polling
// ----------------------------------------------------------------------------
// The Keboola ingress silently drops long SSE connections between the container
// and the browser after 30-60s. We use a two-step polling protocol instead:
//   POST /api/chat/start   → returns { streamId }, upstream fetch runs async
//   GET  /api/chat/poll    → returns { chunk, total, done, error }
// Each poll is a short HTTP call — nothing to drop mid-stream.
// ============================================================================

function getKaiToken(): string {
  // Prefer STORAGE_API_TOKEN (Full Access secret manually added in Advanced
  // Settings → Secrets). KBC_TOKEN is auto-injected but scoped to the app's
  // workspace and returns 403 against tenant-wide kai-assistant.
  return process.env.STORAGE_API_TOKEN || process.env.KBC_TOKEN || '';
}

let kaiBaseUrl: string | null = null;
async function getKaiUrl(): Promise<string> {
  if (kaiBaseUrl) return kaiBaseUrl;
  const storageApiUrl = process.env.KBC_URL || '';
  const discoveryUrl = `${storageApiUrl.replace(/\/$/, '')}/v2/storage`;
  console.debug('[kai] Discovery URL:', discoveryUrl);
  const res = await fetch(discoveryUrl, {
    headers: { 'x-storageapi-token': getKaiToken() },
  });
  if (!res.ok) throw new Error(`Storage API discovery failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { services?: { id: string; url: string }[] };
  const services = data.services || [];
  console.debug('[kai] Available services:', services.map((s) => s.id).join(', '));
  // Search order matches keboola/kai-client (Python reference)
  const kai =
    services.find((s) => s.id === 'kai-assistant') ||
    services.find((s) => s.id === 'ai') ||
    services.find((s) => s.id.includes('kai'));
  if (!kai?.url) {
    throw new Error(`kai-assistant service not found. Available: ${services.map((s) => s.id).join(', ')}`);
  }
  kaiBaseUrl = kai.url.replace(/\/$/, '');
  console.debug('[kai] Discovered service:', kai.id, 'URL:', kaiBaseUrl);
  return kaiBaseUrl;
}

type StreamBuffer = {
  raw: string;
  done: boolean;
  error: string | null;
  updatedAt: number;
  startedAt: number;
};

const streams = new Map<string, StreamBuffer>();
const STREAM_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, buf] of streams) {
    if (now - buf.updatedAt > STREAM_TTL_MS) streams.delete(id);
  }
}, 60_000).unref();

function makeChatBody(reqBody: any, appContext: string): any {
  const body = { ...reqBody };
  // branchId must be a number if present; Kai's Zod schema rejects null.
  const envBranch = process.env.BRANCH_ID ? Number(process.env.BRANCH_ID) : undefined;
  if (envBranch && Number.isFinite(envBranch)) {
    body.branchId = envBranch;
  } else if (body.branchId == null) {
    delete body.branchId;
  }
  // Prepend an app-specific dashboard context so Kai answers grounded in this app.
  if (body.message?.parts?.[0]?.type === 'text') {
    const originalText = body.message.parts[0].text;
    if (!originalText.startsWith('[Dashboard context')) {
      body.message.parts[0].text = `[Dashboard context: ${appContext}]\n\n${originalText}`;
    }
  }
  return body;
}

async function runKaiStream(streamId: string, chatBody: any): Promise<void> {
  const buf = streams.get(streamId);
  if (!buf) return;
  try {
    const kaiUrl = await getKaiUrl();
    const targetUrl = `${kaiUrl}/api/chat`;
    console.debug(`[kai:${streamId}] POST`, targetUrl);
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-storageapi-token': getKaiToken(),
        'x-storageapi-url': process.env.KBC_URL || '',
      },
      body: JSON.stringify(chatBody),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      const hint =
        upstream.status === 403
          ? ' — STORAGE_API_TOKEN likely missing Full Access, or Kai is not enabled for this project.'
          : upstream.status === 404
            ? ' — endpoint /api/chat not found; check discovered service URL in logs.'
            : upstream.status === 400
              ? ' — check that branchId is a number (or omitted), not null.'
              : '';
      buf.error = `Kai upstream ${upstream.status}${hint} Body: ${errText.slice(0, 500)}`;
      buf.done = true;
      buf.updatedAt = Date.now();
      console.error(`[kai:${streamId}] upstream ${upstream.status}:`, errText.slice(0, 300));
      return;
    }
    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf.raw += decoder.decode(value, { stream: true });
      buf.updatedAt = Date.now();
    }
    buf.done = true;
    buf.updatedAt = Date.now();
    const elapsed = ((Date.now() - buf.startedAt) / 1000).toFixed(1);
    console.debug(`[kai:${streamId}] done @ ${elapsed}s (${buf.raw.length} bytes)`);
  } catch (err) {
    buf.error = String(err);
    buf.done = true;
    buf.updatedAt = Date.now();
    console.error(`[kai:${streamId}] error:`, err);
  }
}

// EDIT: replace this with a description specific to your app's data + goals.
const KAI_APP_CONTEXT =
  'User is in a Keboola JS data app. Data is served from Snowflake pre-agg tables.' +
  ' Reply concisely; when quoting numbers, cite which table/column they come from.';

app.post('/api/chat/start', async (req, res) => {
  if (!process.env.STORAGE_API_TOKEN) {
    console.error('[kai] STORAGE_API_TOKEN secret missing — KBC_TOKEN alone will 403');
    return res.status(500).json({
      error:
        'Ask Kai is not configured. Go to Data App → Advanced Settings → Secrets → add STORAGE_API_TOKEN (a Full Access token from Settings → API Tokens).',
    });
  }
  const streamId = crypto.randomUUID();
  const now = Date.now();
  streams.set(streamId, { raw: '', done: false, error: null, updatedAt: now, startedAt: now });
  const chatBody = makeChatBody(req.body, KAI_APP_CONTEXT);
  runKaiStream(streamId, chatBody);
  res.json({ streamId });
});

app.get('/api/chat/poll', (req, res) => {
  const id = String(req.query.id || '');
  const from = Math.max(0, Number(req.query.from || 0));
  const buf = streams.get(id);
  if (!buf) return res.status(404).json({ error: 'Stream not found or expired' });
  const chunk = buf.raw.slice(from);
  const payload = { chunk, total: buf.raw.length, done: buf.done, error: buf.error };
  if (buf.done) setTimeout(() => streams.delete(id), 60_000).unref();
  res.json(payload);
});

// ============================================================================
// Snowflake data endpoint
// ============================================================================

// EDIT: set your actual bucket FQN(s).
const BUCKET = '"KEBOOLA_<project_id>"."out.c-<your-bucket>"';

async function queryTable(tableName: string, limit?: number): Promise<Record<string, unknown>[]> {
  // NOTE: pageSize below is the result-page cap (rows in ONE API response),
  // NOT a SQL LIMIT. Default 10 000 silently truncates larger tables — always
  // pass 50 000+ here. Keboola's max is 100 000.
  const sql = limit
    ? `SELECT * FROM ${BUCKET}."${tableName}" LIMIT ${limit}`
    : `SELECT * FROM ${BUCKET}."${tableName}"`;
  return runSnowflakeQuery(sql, { pageSize: 50_000, timeoutMs: 30_000 });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, mode }));

app.get('/api/data/all', async (_req, res) => {
  try {
    console.debug('[api] Loading all tables…');
    // EDIT: add all your pre-agg tables here in parallel.
    const [kpis /*, byMethod, byMonth, … */] = await Promise.all([
      queryTable('ACC_KPIS'),
      // queryTable('ACC_BY_METHOD'),
    ]);
    console.debug('[api] All data loaded');
    res.json({
      kpis: kpis[0] ?? {},
      // byMethod, byMonth, …
      snapshotAt: (() => {
        const raw = kpis[0]?.SNAPSHOT_AT;
        const seconds = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(seconds) && seconds > 0
          ? new Date(seconds * 1000).toISOString()
          : new Date().toISOString();
      })(),
    });
  } catch (err) {
    console.error('[api] Error loading data:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ============================================================================
// Static serve + SPA fallback
// ============================================================================

app.use(
  express.static(clientDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
      else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    },
  }),
);

app.all('*', (req, res, next) => {
  // Keboola container health-check: POST / expects 200
  if (req.method === 'POST' && req.path === '/') {
    res.status(200).send('ok');
    return;
  }
  if (req.path.startsWith('/api')) {
    next();
    return;
  }
  res.sendFile(path.join(clientDir, 'index.html'), (err) => {
    if (err) next(err);
  });
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`server listening on 127.0.0.1:${port} (${mode})`);
});

// Kai polling flow is short-request so tight timeouts are OK, but idle sockets
// during data loading can be minutes. Disable Node's defaults.
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
server.timeout = 0;
