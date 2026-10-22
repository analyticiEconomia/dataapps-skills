# Back button ("Zpět") — standard on every report

Every report app has an **icon-only back button** in the header, in the same row as refresh and download
(order: theme · back · refresh · download). It returns to the **previous view of the report**: page/tab, drilled-in
item (e.g. selected organisation), date and all header filters. The browser's own back button must do the
same thing.

Requested by the analytics team on Cash Collection (2026-10-22): "to tlačítko na zpět budu chtít v každém
dalším reportu". Reference implementation: `cash-collection-dataapp/src/App.tsx` (project 00 Core / 728).

## Rules

- **Icon only, no text label.** Use lucide `Undo2` (curved back arrow), same `icon-btn` class/size as refresh
  and download. Put the words in `title` + `aria-label`: `Zpět na předchozí pohled`.
- **Disabled** when there is nothing to go back to (first view after load).
- One history step per change of: page, drilled-in item, date/period, any header filter. A filter
  multi-select toggled 3× = 3 steps (that is the expected "undo" behaviour).
- Implement it on top of **`window.history`** (`pushState` / `popstate`), not a private stack — that way the
  browser back button, mouse back button and Alt+← all work for free.
- Page-local UI state (table sort, search text, expanded rows) is **not** part of the history; it resets when
  a page is re-entered. Keep the view state to what the header + navigation control.
- The first view is written with `replaceState`, never `pushState` (otherwise the button is enabled
  immediately and "back" goes nowhere). Wait until async defaults are known (e.g. the default snapshot date
  arrives from the API) before writing the first state.
- When restoring from `popstate`, do **not** push again — set a `restoring` flag, apply the state, then
  `replaceState` once. Compare a stable key (`JSON.stringify` of sorted values) so object identity changes
  don't create phantom steps.

## React (Vite + TS) — drop-in for App.tsx

```tsx
import { Undo2 } from 'lucide-react';

// Everything that defines what the report shows. Sets → sorted arrays so the key is stable.
interface ViewState {
  page: PageId;
  drillOrg: Record<Typ, string | null>; // drilled-in item(s)
  date: string;                          // or period from/to
  companies: string[] | null;            // header filters (null = all)
  intervals: string[] | null;
  bonus: BonusFilter;
}
const viewKey = (v: ViewState) =>
  JSON.stringify([v.page, v.drillOrg.P, v.drillOrg.Z, v.date, v.companies, v.intervals, v.bonus]);

// inside App():
const [histIdx, setHistIdx] = useState(0);
const lastKey = useRef('');
const restoring = useRef(false);
const view: ViewState = useMemo(
  () => ({
    page,
    drillOrg,
    date,
    companies: companies ? [...companies].sort() : null,
    intervals: intervals ? [...intervals].sort() : null,
    bonus,
  }),
  [page, drillOrg, date, companies, intervals, bonus],
);

useEffect(() => {
  if (!date) return; // wait until async defaults are known
  const key = viewKey(view);
  if (key === lastKey.current) return;
  if (!lastKey.current || restoring.current) {
    window.history.replaceState({ ...view, idx: histIdx }, '');
    restoring.current = false;
  } else {
    const idx = histIdx + 1;
    window.history.pushState({ ...view, idx }, '');
    setHistIdx(idx);
  }
  lastKey.current = key;
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [view]);

useEffect(() => {
  const onPop = (e: PopStateEvent) => {
    const st = e.state as (ViewState & { idx?: number }) | null;
    if (!st?.page) return;
    restoring.current = viewKey(st) !== lastKey.current;
    setHistIdx(st.idx ?? 0);
    setPage(st.page);
    setDrillOrg(st.drillOrg);
    setDate(st.date);
    setCompanies(st.companies ? new Set(st.companies) : null);
    setIntervals(st.intervals ? new Set(st.intervals) : null);
    setBonus(st.bonus);
  };
  window.addEventListener('popstate', onPop);
  return () => window.removeEventListener('popstate', onPop);
}, []);

// header, after the theme toggle and before refresh + ExportMenu:
<button
  className="icon-btn"
  title="Zpět na předchozí pohled"
  aria-label="Zpět na předchozí pohled"
  onClick={() => window.history.back()}
  disabled={histIdx === 0}
>
  <Undo2 size={15} />
</button>
```

Adapt `ViewState` to the app: list exactly the state the header and navigation own (tab, drill target,
period, filters). Everything else stays out.

## Vanilla JS (Flask / static `public/app.js` apps)

Same idea without React — wrap the function that applies filters/tab changes:

```js
let histIdx = 0, lastKey = '', restoring = false;
const backBtn = document.getElementById('back-btn'); // <button id="back-btn" class="icon-btn" title="Zpět na předchozí pohled" aria-label="Zpět na předchozí pohled">…undo svg…</button>

function currentView() {           // read from your app state object
  return { tab: state.tab, filters: { ...state.filters } };
}
function recordView() {            // call at the end of every render/applyFilters
  const v = currentView(), key = JSON.stringify(v);
  if (key === lastKey) return;
  if (!lastKey || restoring) { history.replaceState({ ...v, idx: histIdx }, ''); restoring = false; }
  else { histIdx += 1; history.pushState({ ...v, idx: histIdx }, ''); }
  lastKey = key;
  backBtn.disabled = histIdx === 0;
}
window.addEventListener('popstate', (e) => {
  if (!e.state || !e.state.tab) return;
  restoring = JSON.stringify({ tab: e.state.tab, filters: e.state.filters }) !== lastKey;
  histIdx = e.state.idx || 0;
  Object.assign(state, { tab: e.state.tab, filters: e.state.filters });
  render();                        // must end with recordView()
});
backBtn.addEventListener('click', () => history.back());
```

Undo icon SVG (lucide `undo-2`) for apps without lucide:

```html
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
```

## Verify before shipping

1. Fresh load → back button disabled.
2. Change tab → back returns to the original tab; button disabled again.
3. Drill into an item from a table → back returns to the table view.
4. Change two filters → two backs undo them in reverse order, numbers return to the previous totals.
5. Browser back button behaves identically.
