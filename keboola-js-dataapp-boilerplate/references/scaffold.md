# Scaffold — package.json, configs, folder structure

Everything you need to run `npm install && npm run build && node dist/server/index.js` on a fresh clone.

## Folder layout

```
/
├── package.json
├── package-lock.json
├── tsconfig.json                # frontend
├── tsconfig.server.json         # backend
├── vite.config.ts
├── esbuild.server.js            # bundles server/index.ts into dist/server/index.js
├── tailwind.config.js
├── postcss.config.js
├── index.html                   # Vite entry
├── .gitignore
├── keboola-config/              # copied by Keboola container at start
│   ├── setup.sh
│   ├── setup-dev.sh
│   ├── nginx/sites/default.conf
│   ├── supervisord/services/app.conf
│   └── supervisord-dev/services/
│       ├── api.conf
│       └── vite.conf
├── server/
│   ├── index.ts
│   └── kbcQuery.ts
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── StoryPage.tsx            # optional; see design skill
    ├── AskKaiPage.tsx
    ├── DocumentationPage.tsx
    ├── index.css
    └── hooks/
        └── useFetch.ts
```

## `package.json`

Do NOT add `"type": "module"`. `esbuild.server.js` bundles the server to CommonJS
(`format: "cjs"`); if the package is ESM-typed, Node treats the compiled
`dist/server/index.js` as an ES module and crashes on boot with
`ReferenceError: exports is not defined in ES module scope`. Keep `tailwind.config.js` and
`postcss.config.js` as `module.exports` (not `export default`) to match — see pitfalls.md §21.

The `build` script bundles the server with esbuild into ONE self-contained
`dist/server/index.js` (express + all server-side deps inlined, no runtime
`node_modules` needed) instead of just transpiling it with `tsc` — this is what
lets `keboola-config/setup.sh` skip `npm install`/`npm run build` entirely on the
PROD container. `tsc -p tsconfig.server.json --noEmit` still runs in the same
build step purely for type-checking (esbuild transpiles but does not type-check).
See pitfalls.md §30 for why this exists and what breaks if you go back to a plain
`tsc`-compiled `dist/server/` that expects `node_modules` at runtime.

```json
{
  "name": "keboola-dataapp",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev:client": "vite",
    "dev:server": "tsx watch server/index.ts",
    "dev": "concurrently -k \"npm:dev:server\" \"npm:dev:client\"",
    "build": "vite build && tsc -p tsconfig.server.json --noEmit && node esbuild.server.js",
    "start": "node dist/server/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^4.19.2",
    "lucide-react": "^0.454.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.13.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "autoprefixer": "^10.4.20",
    "concurrently": "^9.0.1",
    "esbuild": "^0.28.2",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

Add `google-auth-library`, `googleapis`, or any other server-only package to
`dependencies` as needed (e.g. for `google-group-access.md`) — esbuild bundles
whatever `server/index.ts` actually imports, so new server deps need no other
wiring beyond `npm install` before the next build.

## `tsconfig.json` (frontend)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

## `tsconfig.server.json` (backend)

Used with `--noEmit` for type-checking only now — esbuild does the actual
compile+bundle (see `esbuild.server.js` below). `outDir`/`rootDir` are harmless
leftovers if you ever need to emit for debugging, but the build script never
relies on them.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist/server",
    "rootDir": "server",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["server/**/*"]
}
```

## `esbuild.server.js`

Bundles `server/index.ts` (Express app) into one self-contained
`dist/server/index.js` with express and every other server-side dependency
inlined — the deployed container needs NO `node_modules` at runtime at all,
just this one file plus `dist/client/`. See pitfalls.md §30 for why this
exists instead of a plain `tsc`-compiled `dist/server/`.

```js
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['server/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: 'dist/server/index.js',
    minify: true,
    logLevel: 'info',
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

## `vite.config.ts`

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // Dev only: Keboola health-checks the running container with POST /
    // and expects 200. Vite's default handler returns 404 which makes the
    // dev container look unhealthy.
    command === 'serve' && {
      name: 'keboola-health-check',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.method === 'POST' && req.url === '/') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end('ok');
            return;
          }
          if (req.url === '/health' || req.url === '/api/health') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
    watch: { usePolling: true, interval: 200 },
    proxy: {
      '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false },
    },
  },
  build: { outDir: 'dist/client', emptyOutDir: true },
}));
```

## `tailwind.config.js`

```js
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#5B6CFF',
          accent:  '#8B5CF6', // matches --brand-accent in the design skill's index.css
          purple:  '#8B5CF6',
          success: '#10B981',
          warning: '#F59E0B',
          danger:  '#EF4444',
          slate:   '#64748B',
        },
      },
    },
  },
  plugins: [],
};
```

## `postcss.config.js`

```js
module.exports = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

## `index.html`

```html
<!doctype html>
<html lang="cs">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Data App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## `src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

## `src/hooks/useFetch.ts`

```ts
import { useEffect, useState } from 'react';

export function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<T>;
    }).then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, [url]);
  return { data, error, loading };
}
```

## `keboola-config/setup.sh` (prod)

`dist/` is prebuilt and committed (see pitfalls.md §30), so PROD does not
install or build anything at container start — it just confirms the
prebuilt bundle is in place. This is what cuts a ~20-40s cold start down to
under a second. If you change `package.json` or any source file, you MUST
run `npm install && npm run build` locally and commit the resulting `dist/`
— this script does not do it for you.

```bash
#!/bin/bash
set -Eeuo pipefail
cd /app
echo "PROD setup done (using prebuilt, self-contained dist/)"
```

## `keboola-config/setup-dev.sh` (dev)

```bash
#!/bin/bash
set -Eeuo pipefail
cd /app
npm install
echo "DEV setup done"
```

## `keboola-config/nginx/sites/default.conf`

Routes `/api/chat` and `/api` to Express (on prod :3000 direct, on dev via Vite :3000 → Express :3100), everything else to whatever runs on :3000 (Vite in dev, Express in prod).

Important knobs for our polling flow (short requests, no long SSE):

```nginx
server {
    listen 8888;
    server_name _;

    location /api/chat {
        proxy_pass http://127.0.0.1:3000;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
    }
}
```

## `keboola-config/supervisord/services/app.conf` (prod — Express only)

```ini
[program:app]
command=node /app/dist/server/index.js
directory=/app
autostart=true
autorestart=true
environment=NODE_ENV="production",PORT="3000"
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

## `keboola-config/supervisord-dev/services/vite.conf`

```ini
[program:vite]
command=npx vite --host 127.0.0.1 --port 3000 --strictPort
directory=/app
autostart=true
autorestart=true
environment=NODE_ENV="development",CHOKIDAR_USEPOLLING="1"
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

## `keboola-config/supervisord-dev/services/api.conf`

```ini
[program:api]
command=npx tsx watch server/index.ts
directory=/app
autostart=true
autorestart=true
environment=NODE_ENV="development",PORT="3100",CHOKIDAR_USEPOLLING="1"
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

## `.gitignore`

`dist/` is deliberately NOT ignored — it's committed as the prebuilt artifact
(see pitfalls.md §30). Do NOT try to also commit `node_modules/` "to be safe"
— even pruned to production-only deps it's tens of MB, and pushes that size
get rejected by this git host with HTTP 413. The whole point of the esbuild
bundle is that `node_modules` is never needed on the container at all.

```
node_modules
.env
.env.*
```

## Local dev

Two terminals side by side:

```bash
# terminal 1
npm run dev:server   # Express on :3100

# terminal 2
npm run dev:client   # Vite on :3000, proxies /api to :3100
```

Then open http://127.0.0.1:3000 (Vite dev server). Or use `npm run dev` if `concurrently` works well on your platform (occasionally flaky on Windows).

Environment for local dev — set these in a `.env` file at the repo root (loaded by neither Vite nor tsx by default, so you'll need `dotenv` OR set them in shell before running the server):

```
KBC_URL=https://connection.<region>.keboola.com
KBC_TOKEN=<your-personal-token>
STORAGE_API_TOKEN=<full-access-token-for-kai>
BRANCH_ID=<default-branch-id>
WORKSPACE_ID=<a-workspace-id-with-access-to-your-buckets>
```

The `readEnv()` helper in `server/kbcQuery.ts` throws a descriptive error if any are missing, so you'll know exactly what to set.
