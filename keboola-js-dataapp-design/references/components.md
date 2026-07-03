# Design components

All examples assume Tailwind + `lucide-react` icons + `recharts` are installed. Types are inline for clarity — inline them or move to your own `types.ts`.

## `<ChartExplainer>` — MANDATORY wrapper

The rule that makes the report usable by non-analysts. Every chart is inside one.

```tsx
import { HelpCircle, X } from 'lucide-react';
import { useState } from 'react';

interface ChartExplainerProps {
  howToRead: string;
  dataSource: string;
  caveat?: string;
  title?: string;
  children: React.ReactNode;
}

export function ChartExplainer({ howToRead, dataSource, caveat, title, children }: ChartExplainerProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chart-explainer">
      {title && <div className="text-sm font-medium text-slate-300 mb-3">{title}</div>}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="chart-explainer-toggle"
        aria-label={open ? 'Hide explainer' : 'Show explainer'}
        title={open ? 'Hide explainer' : 'How to read this chart'}
      >
        {open ? <X size={14} /> : <HelpCircle size={14} />}
      </button>
      {children}
      {open && (
        <div className="chart-explainer-panel" role="region" aria-label="Chart explainer">
          <h5>How to read</h5>
          <p>{howToRead}</p>
          <h5>Where the number comes from</h5>
          <p>{dataSource}</p>
          {caveat && (
            <>
              <h5>Caveat</h5>
              <p>{caveat}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

Usage:

```tsx
<ChartExplainer
  title="Payments by method"
  howToRead="Each slice is one payment method. The bigger the slice, the more payments went through that method."
  dataSource="We count every recorded payment across the platform and group them by the method the payer used — Bank API, mark-then-pay, manual bank entry, or automatic reader pairing."
  caveat="A single document paid in multiple installments counts once per installment, not once per document."
>
  <ResponsiveContainer width="100%" height={280}><PieChart>…</PieChart></ResponsiveContainer>
</ChartExplainer>
```

## `<InsightCard>` — one card per insight in Classic mode

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface InsightCardProps {
  number: number;
  headline: string;
  meaning: string;
  recommendation: string;
  source: string;
  children?: React.ReactNode;
}

export function InsightCard({ number, headline, meaning, recommendation, source, children }: InsightCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="insight-card">
      <div className="text-xs text-slate-400 mb-1">INSIGHT #{number}</div>
      <h3 className="insight-headline">{headline}</h3>
      {children && <div className="my-4">{children}</div>}
      <div className="insight-meta space-y-2">
        <div><span className="text-blue-400">📌 What it means:</span> {meaning}</div>
        <div><span className="text-emerald-400">🎯 Recommendation:</span> {recommendation}</div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-slate-500">📂 Source: {source}</span>
          <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-slate-400 hover:text-slate-300">
            📖 How to read {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
        {/* Optional expandable "how to read" — or use ChartExplainer inside `children`. */}
      </div>
    </div>
  );
}
```

## `<HeroKpi>` — the big animated number

```tsx
interface HeroKpiProps {
  value: string;
  label: string;
  variant?: 'primary' | 'success' | 'warning' | 'danger';
}
export function HeroKpi({ value, label, variant = 'primary' }: HeroKpiProps) {
  const cls = {
    primary: 'kpi-hero',
    success: 'kpi-hero kpi-hero-success',
    warning: 'kpi-hero kpi-hero-warning',
    danger:  'kpi-hero kpi-hero-danger',
  }[variant];
  return (
    <div className="text-center">
      <div className={cls}>{value}</div>
      <div className="text-sm text-slate-400 mt-1">{label}</div>
    </div>
  );
}
```

For Story mode use the CSS class `story-hero-number` directly (larger clamp size). Pair with `<CountUp>`.

## `<CountUp>` — number animates when scrolled into view

```tsx
import { useEffect, useRef, useState } from 'react';

function useInView<T extends HTMLElement>(threshold = 0.3) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setInView(true); io.unobserve(e.target); } }),
      { threshold, rootMargin: '0px 0px -10% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView };
}

export function CountUp({ value, decimals = 0, suffix = '', prefix = '', duration = 1400 }: {
  value: number; decimals?: number; suffix?: string; prefix?: string; duration?: number;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // easeOutExpo
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration]);
  return (
    <span ref={ref}>
      {prefix}
      {display.toLocaleString('cs-CZ', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}
```

## `<Fade>` — cascade fade-in for Story sections

```tsx
export function Fade({ children, delay = 0, className = '' }: {
  children: React.ReactNode; delay?: 0 | 1 | 2 | 3 | 4 | 5; className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.15);
  return (
    <div ref={ref} data-delay={delay} className={`story-fade ${inView ? 'visible' : ''} ${className}`}>
      {children}
    </div>
  );
}
```

## `<MiniKpi>` — 2×2 or 4× compact stat grid

```tsx
export function MiniKpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="mini-kpi">
      <div className="mini-kpi-value">{value}</div>
      <div className="mini-kpi-label">{label}</div>
    </div>
  );
}
```

## `<DataTable>` — drill-down list with CSV export

```tsx
import { Download } from 'lucide-react';

interface Column { key: string; label: string; format?: (v: unknown) => string; }

export function DataTable({ data, columns, filename, maxRows = 25 }: {
  data: Record<string, unknown>[]; columns: Column[]; filename: string; maxRows?: number;
}) {
  const displayData = data.slice(0, maxRows);
  const downloadCsv = () => {
    const header = columns.map((c) => c.label).join(',');
    const rows = data.map((row) => columns.map((c) => String(row[c.key] ?? '')).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-slate-500">
          {data.length > maxRows ? `Showing ${maxRows} of ${data.length}` : `${data.length} rows`}
        </span>
        <button onClick={downloadCsv} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
          <Download size={12} /> CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-700/50">
        <table className="data-table">
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {displayData.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => <td key={c.key}>{c.format ? c.format(row[c.key]) : String(row[c.key] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

## Number formatters

```tsx
export function formatNumber(n: unknown): string {
  const num = Number(n);
  if (isNaN(num)) return '—';
  return num.toLocaleString('cs-CZ');
}

export function formatCompact(n: unknown): string {
  const num = Number(n);
  if (isNaN(num)) return '—';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(0) + 'K';
  return num.toLocaleString('cs-CZ');
}

export function formatCurrency(n: unknown): string {
  const num = Number(n);
  if (isNaN(num)) return '—';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + ' mld Kč';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + ' mil Kč';
  if (num >= 1_000) return (num / 1_000).toFixed(0) + ' tis Kč';
  return num.toLocaleString('cs-CZ') + ' Kč';
}

export function formatPct(n: unknown): string {
  const num = Number(n);
  if (isNaN(num)) return '—';
  return num.toFixed(1) + '%';
}
```

## Recharts theme

Always pass this style pattern to `<Tooltip>`. `contentStyle` alone is not enough — Recharts'
default tooltip text color is black, which is unreadable against the dark `contentStyle`
background. Explicitly set `itemStyle` and `labelStyle` too:

```tsx
contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 12 }}
itemStyle={{ color: '#E2E8F0' }}
labelStyle={{ color: '#E2E8F0' }}
```

Colors:

```ts
export const PIE_COLORS = ['#5B6CFF', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];
export const COLORS = {
  primary: '#5B6CFF',
  purple: '#8B5CF6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  slate: '#64748B',
};
```
