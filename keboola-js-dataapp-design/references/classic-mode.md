# Classic mode — tabbed report

Classic is the workhorse. Sidebar with tabs, one page per feature area, insight cards stacked vertically inside each page. Made for analytical work — drill into anomalies, download CSVs, cross-reference numbers.

## Layout

```
┌──────────────┬──────────────────────────────────┐
│              │                                  │
│  Sidebar     │  Main content (max-w-4xl)        │
│              │                                  │
│  📖 Docs     │  <Page title />                  │
│  📊 Overview │                                  │
│  💰 Payments │  <InsightCard #1>                │
│  🏦 Bank     │    - headline                    │
│  💳 Cards    │    - chart with ChartExplainer   │
│  🤖 Ask Kai  │    - meaning + recommendation    │
│              │  </InsightCard>                  │
│              │                                  │
│              │  <InsightCard #2>                │
│              │  …                               │
│              │                                  │
└──────────────┴──────────────────────────────────┘
```

## Required order of tabs

1. **Documentation** — always leftmost, mandatory (see `required-pages.md`)
2. **Overview** — hero KPIs + 3–5 top-level insights that answer the "so what?"
3. **Feature area tabs** — one per major theme (Payments, Bank, Cards, etc.)
4. **Ask Kai** — always rightmost, mandatory (see `required-pages.md`)

## Sidebar template

```tsx
// EDIT: tailor NAV_ITEMS to your app's feature areas.
// The first entry MUST be Documentation; the last MUST be Ask Kai.
const NAV_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'docs',      label: 'Documentation', icon: <BookOpen size={16} /> },
  { page: 'overview',  label: 'Overview',      icon: <BarChart3 size={16} /> },
  { page: 'feature-a', label: 'Feature A',     icon: <Wallet size={16} /> },
  { page: 'feature-b', label: 'Feature B',     icon: <Building2 size={16} /> },
  { page: 'askkai',    label: 'Ask Kai',       icon: <MessageCircle size={16} /> },
];

// EDIT: replace APP_NAME + APP_INITIAL with your app's branding.
const APP_NAME = '<Your App Name>';
const APP_INITIAL = APP_NAME[0].toUpperCase();

<aside className="fixed lg:sticky top-0 left-0 h-screen w-56 bg-slate-900/95 border-r border-slate-800 backdrop-blur-sm">
  <div className="p-4">
    <div className="flex items-center gap-2 mb-6">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
        <span className="text-white text-sm font-bold">{APP_INITIAL}</span>
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{APP_NAME}</div>
        <div className="text-xs text-slate-500">{TOTAL_INSIGHTS} insights</div>
      </div>
    </div>
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => (
        <button key={item.page} onClick={() => setPage(item.page)}
          className={`nav-item w-full ${page === item.page ? 'active' : ''}`}>
          {item.icon}<span>{item.label}</span>
        </button>
      ))}
    </nav>
  </div>
  <div className="absolute bottom-4 left-4 right-4 space-y-3">
    <button onClick={() => switchToStoryMode()}
      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/40 text-purple-200 text-xs font-semibold hover:from-purple-500/30 hover:to-pink-500/30">
      <Sparkles size={13} /> Switch to Story mode
    </button>
    <div className="text-xs text-slate-600">
      Snapshot: {new Date(data.snapshotAt).toLocaleDateString('cs-CZ')}
    </div>
  </div>
</aside>
```

## Page template

Every feature page (Overview, Payments, Bank…) follows this shape:

```tsx
function PaymentsPage({ data }: { data: DataResponse }) {
  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">💰 Payments</h1>
        <p className="text-sm text-slate-400">5 insights about payment behavior and adoption.</p>
      </div>

      <InsightCard
        number={1}
        headline={`Only ${bankApiPct.toFixed(1)} % of payments go through Bank API.`}
        meaning="…"
        recommendation="…"
        source="ACC_PAYMENT_KPIS.N_BANK_API / TOTAL_PAYMENTS"
      >
        <ChartExplainer
          howToRead="…"
          dataSource="…"
        >
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>…</PieChart>
          </ResponsiveContainer>
        </ChartExplainer>
      </InsightCard>

      {/* more InsightCards */}
    </div>
  );
}
```

Note the nesting: `<InsightCard>` (for the "what does this mean + recommendation" wrap) contains a `<ChartExplainer>` (for the "how to read the chart" wrap) which contains the actual chart. **Both wrappers are required.**

## InsightCard vs ChartExplainer — when each

- **InsightCard** is the outer wrapper for an insight. It carries the numbered headline, the "what it means" interpretation, the "recommendation", and the source citation. Always present in Classic mode.
- **ChartExplainer** is the inner wrapper around the chart itself. It carries the "how to read" and "where the number comes from" copy. Always present when there's a chart.

Not every InsightCard needs a chart — some are purely narrative + a single big number. Not every ChartExplainer lives inside an InsightCard — Story mode uses ChartExplainer standalone.

## Insight numbering

Use a single monotonic sequence across all Classic pages (not restarting per page). `#1` on Overview, `#6` on Payments, etc. This lets you say "see insight #12" in Slack conversations without qualifying which tab.

Show `INSIGHT #N` as a small gray eyebrow above the headline (built into `<InsightCard>`).

## Grouping insights per page

Aim for **3–5 insights per feature page**. Fewer than 3 → merge with an adjacent page. More than 6 → split into two pages. Board / stakeholder users skim; a wall of 12 cards on one page reads as dumping data.

## Sidebar counter

The "N insights" line under the app title in the sidebar should reflect the actual count across all pages. Update whenever you add/remove insights.

## Mobile

Sidebar collapses into a hamburger; use `sidebar-open` state on the mobile menu button. Main content is same but stacks vertically.

## Empty-state cards

If an insight's underlying data is empty (transformation returned 0 rows) — hide the card, don't render an empty one with dashes. Show a small `<div className="insight-card">This section has no data for the current snapshot.</div>` at the bottom of the page as a group hint.
