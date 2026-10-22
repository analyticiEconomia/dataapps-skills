# Export / Download Menu (CSV, PNG, PDF)

> **Header companion — back button:** every report also gets an icon-only back button ("Zpět", lucide `Undo2`) left of refresh and the download icon, built on `window.history`. Rules + code: `references/back-navigation.md`.


**Use this when:** building or migrating any dashboard-style data app (Streamlit or Python/JS). This is a **standard feature for every report app**, not an opt-in extra — add it by default the same way you add loading/error states.

**Proven on:** Traffic report (Keboola project 757, Python/Flask + vanilla JS), 2026-09-18.

## Contents
- The UX pattern
- Vanilla JS / Node implementation
- React implementation
- Streamlit implementation
- Gotcha: `[hidden]` vs a CSS class with equal specificity
- Gotcha: wide/scrolling tables get clipped by html2canvas
- Gotcha: don't swap `textContent` on an icon button

## The UX pattern

One icon button (a proper download glyph — arrow into a tray, not a bare `↓`/`⬇`), placed in the header next to the refresh control. Clicking it opens a small dropdown with **plain-text** options: `CSV`, `PNG`, `PDF`. No emoji, no extra wording ("Obrázek", icons) in the item labels — just the format name. Closes on: picking an option, clicking outside, `Escape`.

```html
<span class="export-menu">
  <button id="export-toggle" title="Stáhnout aktuální záložku" aria-haspopup="true" aria-expanded="false">
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M12 3v11.4m0 0-4-4m4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M4 16.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
  <span id="export-dropdown" class="export-dropdown" hidden>
    <button id="export-csv" data-kind="csv">CSV</button>
    <button id="export-image" data-kind="image">PNG</button>
    <button id="export-pdf" data-kind="pdf">PDF</button>
  </span>
</span>
```

- **CSV** exports the *currently rendered/filtered* tab's data — reuse the JSON already fetched for the page, don't round-trip to the server. Semicolon-delimited + UTF-8 BOM (`"﻿" + ...`) so it opens correctly in Czech-locale Excel (comma is the decimal separator there, not the field separator).
- **PNG / PDF** both rasterize the active tab's DOM (tables *and* canvases/charts) via `html2canvas`, then either save the canvas directly (PNG) or drop it into a single-page `jsPDF` document sized to the canvas (PDF). One capture function powers both — don't write two.

## Vanilla JS / Node implementation

CDN libs (no bundler needed, matches the `python-js-apps.md` no-bundler default):

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
```

```javascript
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvEscape(v) {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tableToCSV(columns, rows) {
  const header = columns.map((c) => csvEscape(c.label));
  const lines = rows.map((r) => columns.map((c) => csvEscape(r[c.key] ?? "")));
  return "﻿" + [header, ...lines].map((l) => l.join(";")).join("\r\n");
}

// Expand any scrollable table wrappers to their full content width/height
// before capture, then restore — see "wide tables" gotcha below.
async function withExpandedTables(root, fn) {
  const wraps = [...root.querySelectorAll(".table-wrap")];
  const saved = wraps.map((w) => ({ el: w, overflow: w.style.overflow, width: w.style.width }));
  wraps.forEach((w) => {
    w.style.width = `${w.scrollWidth}px`;
    w.style.overflow = "visible";
  });
  try {
    return await fn();
  } finally {
    saved.forEach((s) => { s.el.style.overflow = s.overflow; s.el.style.width = s.width; });
  }
}

async function captureContent() {
  const target = document.getElementById("content");
  return withExpandedTables(target, () =>
    html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: 2,
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: document.documentElement.scrollWidth,
    }),
  );
}

// PNG
const canvas = await captureContent();
canvas.toBlob((blob) => downloadBlob(blob, `${tabName}_${todayStamp()}.png`), "image/png");

// PDF — one page, sized to the captured canvas
const { jsPDF } = window.jspdf;
const orientation = canvas.width >= canvas.height ? "l" : "p";
const pdf = new jsPDF({ orientation, unit: "px", format: [canvas.width, canvas.height] });
pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
pdf.save(`${tabName}_${todayStamp()}.pdf`);
```

CSV data source: keep whatever the tab last fetched in a module-level variable (e.g. `currentCsvExporter = () => ({ filename, csv: tableToCSV(data.columns, data.rows) })`, reassigned each time a tab renders) rather than re-fetching — the export should reflect exactly what's on screen, including active filters.

## React implementation

Same three libraries have React-friendly equivalents — `html2canvas` still works as-is (call it on a `ref.current`); for PDF, either keep `jspdf` directly or use `react-to-print` for a print-dialog-based PDF instead of a rasterized one (crisper text, no image compression, but the user picks "Save as PDF" in their OS print dialog rather than getting a direct download — decide per app which trade-off fits). Wire the menu as a small popover component (Radix `DropdownMenu` or your existing menu primitive) rather than hand-rolling `hidden`/click-outside — but if hand-rolling, the CSS gotcha below still applies.

## Streamlit implementation

Streamlit has no DOM to rasterize client-side, so the pattern splits:
- **CSV**: `st.download_button("CSV", data=df.to_csv(index=False, sep=";").encode("utf-8-sig"), file_name=f"{tab}.csv", mime="text/csv")` — the `utf-8-sig` encoding adds the BOM for Excel, same reasoning as above.
- **PNG**: if the content is a Plotly figure, `fig.to_image(format="png")` (needs `kaleido` installed) fed to `st.download_button`. For a full-page screenshot there's no clean server-side equivalent — either skip PNG for Streamlit apps or accept a per-chart-only PNG export.
- **PDF**: build with `reportlab` or `weasyprint` server-side from the same dataframe, or omit if not worth the added dependency weight for the app.

Streamlit's own `st.download_button` already renders as a normal button — group two or three of them together rather than trying to replicate the JS dropdown; a `st.popover` can act as the collapsing menu if you want the same "one icon, then options" shape.

## Gotcha: `[hidden]` vs a CSS class with equal specificity

If the dropdown is toggled via the `hidden` attribute (`el.hidden = true/false`), **never** give the same element an unconditional class rule like `.export-dropdown { display: flex; }`. Both `[hidden]` (browser default) and `.export-dropdown` are single-selector rules — equal specificity — so whichever is declared later in the stylesheet wins the cascade, and since your own CSS loads after the UA stylesheet, `display: flex` wins and the menu shows open by default. Fix: add an explicit, higher-specificity override:

```css
.export-dropdown[hidden] { display: none; }
```

## Gotcha: wide/scrolling tables get clipped by html2canvas

A `.table-wrap { overflow-x: auto }` container only shows its scrolled viewport to html2canvas — anything scrolled out of view is clipped in the capture. Temporarily set the wrapper to `width: <scrollWidth>px; overflow: visible` before capture and restore after (see `withExpandedTables` above). Don't skip this — it's the difference between a usable export and one missing half the columns.

## Gotcha: don't swap `textContent` on an icon button

If the toggle button holds an inline `<svg>` icon (not text), a busy-state helper that does `btn.textContent = "…"` then restores `btn.textContent = original` will **destroy the SVG permanently** — `original` was captured as `""` (an `<svg>` has no text content), so the "restore" wipes the icon. Use a CSS class + `disabled` instead of touching `textContent`/`innerHTML` on icon-only buttons:

```javascript
async function withDisabled(btn, fn) {
  btn.disabled = true;
  btn.classList.add("busy");
  try { await fn(); } finally { btn.disabled = false; btn.classList.remove("busy"); }
}
```

```css
#export-toggle.busy { opacity: 0.5; }
```
