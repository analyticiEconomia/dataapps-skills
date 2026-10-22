# Economia branding — the „e.“ mark, wordmark and favicon

Every Economia report app carries the Economia brand mark — the black **„e.“** (the „e“ + dot from the
e.conomia logo) — in the top-left corner next to the app name. Requested by the analytics team on
2026-10-19/22 as a standard for all reports. Reference implementation: `cash-collection-dataapp`
(project 00 Core / 728) — `public/`, sidebar in `src/App.tsx`, export strip in `src/lib/export.ts`.

## Files (in this skill's `assets/`)

| File | Size | Use |
|---|---|---|
| `economia-e.png` | 256 × 195, transparent | **Default** — sidebar/header mark on light backgrounds (displayed ~40 px tall) |
| `economia-e-hires.png` | 570 × 435, transparent | Larger placements, PNG/PDF exports at 2× scale, slides |
| `economia-e-white.png` | 256 × 195, transparent, white | Same mark for dark backgrounds (dark header, Story-mode cover) |
| `economia-wordmark.png` | 1200 × 142, transparent | Full „e.conomia“ wordmark — only where there is room for a wide logo (cover, docs page header); never squeezed into the sidebar |
| `favicon.png` | 64 × 64 | Browser-tab icon (official Economia favicon: white „e.“ on dark square) |
| `favicon-180.png` | 180 × 180 | Optional `apple-touch-icon` / pinned tab |

Source: cropped from the official wordmark on economia.cz (`/wp-content/uploads/2019/01/economia_logo.png`)
and the site favicon (`/wp-content/uploads/2019/02/favicon-300x300.jpg`). Don't use the 100 px navy/blue
„e.“ from the economia.cz theme folder — it is too low-res and blurs.

## Where it goes

1. **Sidebar / header** — mark left of the app name, app name + one-line subtitle stacked to the right:

   ```tsx
   <div className="px-2 pt-1 pb-5 flex items-center gap-3">
     <img src="/economia-e.png" alt="Economia" className="h-10 w-auto shrink-0" />
     <div className="min-w-0">
       <div className="text-lg font-bold text-slate-900 leading-tight">{APP_NAME}</div>
       <div className="text-xs text-slate-500 mt-0.5">{APP_SUBTITLE}</div>
     </div>
   </div>
   ```

   Vanilla/Flask apps: same structure in `index.html`, `<img src="/economia-e.png" height="40">`.

2. **Favicon** — in `index.html`:

   ```html
   <link rel="icon" type="image/png" href="/favicon.png" />
   <title>{APP_NAME} · Economia</title>
   ```

3. **PNG / PDF exports** — the sidebar is not part of the captured area, so add a brand strip at the top of
   the captured container that is hidden on screen and revealed only in the html2canvas copy:

   ```tsx
   <div className="export-only items-center gap-3 mb-4">
     <img src="/economia-e.png" alt="Economia" className="h-8 w-auto" />
     <div className="text-sm text-slate-500">{APP_NAME} · stav {dateText}</div>
   </div>
   ```

   ```css
   .export-only { display: none; }
   ```

   ```ts
   html2canvas(el, {
     // …
     onclone: (doc) => doc.querySelectorAll<HTMLElement>('.export-only').forEach((n) => (n.style.display = 'flex')),
   });
   ```

## Setup

Copy into the app's static folder at scaffold time (Vite: `public/`, Flask: `public/` or `static/`):

```bash
cp <this skill>/assets/economia-e.png public/
cp <this skill>/assets/favicon.png public/
```

Vite copies `public/` into `dist/client/` on build — remember `dist/` is committed (boilerplate pitfalls §30).

## Don'ts

- Don't recolour the mark (no red/brand-accent „e.“) — black on light, white on dark only.
- Don't stretch it: always `h-… w-auto`.
- Don't replace the app name with the logo — the mark sits next to the name, it doesn't stand in for it.
