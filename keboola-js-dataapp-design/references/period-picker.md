# Period picker („Vybrané období“) — house standard for date filters

Every Economia report with a date range uses **one header button that opens a popover**, never two bare labelled date inputs in the header. Reference implementation: *Analýza podcastů Aktuálně* (React) and *PP Aktuálně* (Flask / vanilla JS).

## What it looks like

- Button in the header filter row: calendar icon (Lucide `CalendarRange`) · `1. 10. 2026 – 31. 10. 2026` · chevron (rotates when open). When a range is set the button uses the active-filter style (accent border / accent text).
- Popover, right-aligned under the button, ~290 px wide:
  1. Two date inputs side by side, small labels **Od** / **Do**, `min`/`max` = first / last day with data.
  2. Muted line `Data k dispozici: 31. 12. 2025 – 1. 11. 2026`.
  3. Preset chips, in this order: **Celé období · Posledních 30 dní · Posledních 90 dní · Tento měsíc · Minulý měsíc · Letos**.
- Closes on outside click and Escape. A preset click applies the range and closes the popover; typing a date applies it immediately (debounced) and keeps it open.
- The chip that matches the current range is highlighted (nice to have).

## Preset rules

All presets count back from **the last day with data** (`max`), not from today — data usually ends yesterday (or earlier for YouTube).

| Preset | From | To |
|---|---|---|
| Celé období | `min` (or empty = no filter) | `max` (or empty) |
| Posledních 30 / 90 dní | `max − 29` / `max − 89` | `max` |
| Tento měsíc | 1st of `max`'s month | `max` |
| Minulý měsíc | 1st of the month before `max`'s month | last day of that month |
| Letos | 1 Jan of `max`'s year | `max` |

Clamp `from` to `min`. Dates are ISO strings; do date maths in UTC (`new Date(iso + 'T00:00:00Z')`) so DST never shifts a day.

The period is part of the view state → it goes into the back-button history (`references/back-navigation.md`) and into the PNG/PDF export strip and CSV header (`references/export-download.md`).

## React drop-in

Uses the `Dropdown` shell (outside click + Escape) and the `.filter-btn`, `.filter-panel`, `.filter-label`, `.input`, `.chip` classes from `references/index.css`.

```tsx
import { CalendarRange } from 'lucide-react';

export type DatePreset = 'all' | '30' | '90' | 'month' | 'prev-month' | 'year';

const PRESETS: [DatePreset, string][] = [
  ['all', 'Celé období'],
  ['30', 'Posledních 30 dní'],
  ['90', 'Posledních 90 dní'],
  ['month', 'Tento měsíc'],
  ['prev-month', 'Minulý měsíc'],
  ['year', 'Letos'],
];

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// '' = no bound (Celé období).
export function presetRange(p: DatePreset, min: string, max: string): [string, string] {
  if (p === 'all') return ['', ''];
  let from: string;
  let to = max;
  if (p === 'month') from = max.slice(0, 8) + '01';
  else if (p === 'prev-month') {
    to = addDays(max.slice(0, 8) + '01', -1);
    from = to.slice(0, 8) + '01';
  } else if (p === 'year') from = max.slice(0, 4) + '-01-01';
  else from = addDays(max, -(Number(p) - 1));
  return [from < min ? min : from, to];
}

const fmt = (iso: string) => iso.split('-').reverse().map(Number).join('. ');

export function DateFilter({ from, to, min, max, onFrom, onTo, onPreset }: {
  from: string; to: string; min: string; max: string;
  onFrom: (v: string) => void; onTo: (v: string) => void; onPreset: (p: DatePreset) => void;
}) {
  const label = from || to ? `${fmt(from || min)} – ${fmt(to || max)}` : 'Celé období';
  return (
    <Dropdown label={label} icon={<CalendarRange size={14} />} active={!!(from || to)}>
      <div className="p-3 w-72 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="filter-label">Od</span>
            <input type="date" className="input" value={from} min={min} max={max} onChange={(e) => onFrom(e.target.value)} />
          </label>
          <label>
            <span className="filter-label">Do</span>
            <input type="date" className="input" value={to} min={min} max={max} onChange={(e) => onTo(e.target.value)} />
          </label>
        </div>
        <div className="text-[11px] text-slate-500">Data k dispozici: {fmt(min)} – {fmt(max)}</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(([k, l]) => {
            const [pf, pt] = presetRange(k, min, max);
            const on = pf === from && pt === to;
            return (
              <span key={k} className={`chip ${on ? 'chip-on' : 'chip-off'}`} onClick={() => onPreset(k)}>
                {l}
              </span>
            );
          })}
        </div>
      </div>
    </Dropdown>
  );
}
```

In the app: `onPreset={(p) => { const [f, t] = presetRange(p, minDate, maxDate); setDateFrom(f); setDateTo(t); }}`.

## Vanilla JS (Flask apps)

Same markup idea: `<span id="f-period">` with a toggle button and a hidden panel holding `#f-from` / `#f-to` and `<button class="chip" data-preset="…">` chips. Keep the input ids `f-from` / `f-to` so existing view-state / history code keeps working; call a `syncPeriodUi()` (updates the button text + highlighted chip) at the start of the report loader so history restores update the label too. Full working code: the `economia-tableau-to-dataapp` skill template (`public/index.html` `#f-period`, `public/app.js` `presetRange` / `syncPeriodUi` / `initPeriodPicker`, `public/style.css` `.dp-*`).

## Verify

- Open the popover, click each preset, check the button label and that the report reloads with that range (Minulý měsíc on data ending 1. 11. → 1. 10. – 31. 10.).
- Outside click and Escape close it; back button restores the previous range and the label.
- Both themes: chips and inputs readable in light and dark.
