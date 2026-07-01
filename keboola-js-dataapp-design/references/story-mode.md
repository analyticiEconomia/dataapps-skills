# Story mode — dramaturgical arc

Story mode is a single vertical scroll broken into chapters. The reader doesn't navigate — the report navigates them. The order of chapters is the order of a good argument, not the order the data was produced.

## The default arc

**Act 1 — Set the scene.** Who is this about, and how big is it?
- Cover (title, snapshot date, 4 headline KPIs)
- Scale (hero currency + user base)
- Trend (time-series area chart, "we are growing")

**Act 2 — The pattern.** How do people actually behave?
- Methods (adoption breakdown, one dominant behavior)
- Workflow (do they follow the recommended flow — usually no)
- Speed (how fast do things happen)

**Act 3 — The conflict.** Where does the picture get complicated?
- Complexity (real world doesn't fit the model 1:1)
- Bank reality (external world vs internal state)
- Quality & risks (where data smells or process breaks)

**Act 4 — The audience.** Who are the users, and what do they use?
- Customers / ERP breakdown
- Card transactions (if applicable — otherwise skip)

**Act 5 — Resolution.**
- Recommendations (3 numbered, priority-ordered)
- End (Q&A / Ask Kai CTA)

## Copy pattern per chapter

Every chapter has these four blocks stacked vertically:

1. **Eyebrow** — small caps, chapter number + name  → `<div className="story-eyebrow">Chapter 4 · Workflow adoption</div>`
2. **Title** — one strong sentence, often with a colored callout word  → `<h2 className="story-title">Most users <span className="text-amber-400">don't use</span> Mark for payment.</h2>`
3. **Lead** — 2–3 sentences setting up the numbers  → `<p className="story-lead">…</p>`
4. **Content** — a chart, a hero number, or a three-card row (see below)

Then keep chapters visually distinct: alternate between "hero number left, chart right" and "chart alone" and "3 cards row" layouts. Don't repeat the same layout twice in a row — it looks lazy.

## Chapter component template

```tsx
<Section id="workflow">
  <Fade><div className="story-eyebrow mb-4">Chapter 4 · Workflow adoption</div></Fade>
  <Fade delay={1}>
    <h2 className="story-title mb-6">
      Most users <span className="text-amber-400">don't use</span> Mark for payment.
    </h2>
  </Fade>
  <Fade delay={2}>
    <p className="story-lead mb-12">…lead copy…</p>
  </Fade>

  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    <Fade delay={2}>
      <div className="story-callout-danger">
        <div className="story-eyebrow mb-2 !text-rose-300">Never uses</div>
        <div className="text-5xl font-bold text-white tabular-nums">
          <CountUp value={neverUse} />
        </div>
        <div className="text-sm text-slate-300 mt-1">{neverPct} % of organizations</div>
        <div className="story-caption mt-3">One sentence interpretation.</div>
      </div>
    </Fade>
    <Fade delay={3}>{/* second card */}</Fade>
    <Fade delay={4}>{/* third card */}</Fade>
  </div>
</Section>
```

## `<Section>` primitive

Every chapter is a full-viewport `Section`:

```tsx
function Section({ id, children, minHeight = '100vh' }: {
  id: string; children: React.ReactNode; minHeight?: string;
}) {
  return (
    <section id={id} data-chapter={id} style={{ minHeight }}
      className="w-full flex flex-col justify-center px-6 lg:px-16 py-24">
      <div className="max-w-6xl mx-auto w-full">{children}</div>
    </section>
  );
}
```

`data-chapter` is picked up by the `IntersectionObserver` that drives the right-side progress dots.

## Progress dots

Fixed on the right side, one dot per chapter. Fills in as you scroll.

```tsx
const CHAPTERS = [
  { id: 'cover', label: 'Intro' },
  { id: 'scale', label: 'Scale' },
  { id: 'trend', label: 'Trend' },
  { id: 'methods', label: 'How they pay' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'speed', label: 'Speed' },
  { id: 'complexity', label: 'Complexity' },
  { id: 'bank', label: 'Bank reality' },
  { id: 'quality', label: 'Quality & risks' },
  { id: 'customers', label: 'Customers' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'end', label: 'Ask Kai' },
];

function ProgressNav({ activeId, onNavigate }: { activeId: string; onNavigate: (id: string) => void }) {
  return (
    <nav className="story-progress hidden xl:flex">
      {CHAPTERS.map((c) => (
        <button key={c.id} onClick={() => onNavigate(c.id)}
                className={`story-progress-dot ${activeId === c.id ? 'active' : ''}`}
                aria-label={c.label}>
          <span className="story-progress-label">{c.label}</span>
        </button>
      ))}
    </nav>
  );
}
```

Wire up in the parent Story component:

```tsx
useEffect(() => {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) {
        const id = (e.target as HTMLElement).dataset.chapter;
        if (id) setActiveId(id);
      }
    }),
    { threshold: 0.5 },
  );
  document.querySelectorAll('[data-chapter]').forEach((el) => io.observe(el));
  return () => io.disconnect();
}, []);
```

## Cover chapter template

The first thing on the screen. Simple, big, with 4 headline KPIs.

```tsx
<Section id="cover">
  <Fade><div className="story-eyebrow mb-6">{APP_NAME} · Snapshot {formatDate(data.snapshotAt)}</div></Fade>
  <Fade delay={1}>
    <h1 className="story-title mb-8" style={{ fontSize: 'clamp(2.5rem, 7vw, 5rem)' }}>
      {/* EDIT: title sentence — colored span highlights the key concept */}
      How {APP_SUBJECT} <span style={{ background: 'linear-gradient(135deg, #A5B4FC 0%, #C4B5FD 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{APP_HIGHLIGHT}</span>
    </h1>
  </Fade>
  <Fade delay={2}>
    <p className="story-lead mb-12">One-paragraph pitch of the report…</p>
  </Fade>
  <Fade delay={3}>
    <div className="flex flex-wrap gap-8 items-baseline">
      <KpiCell label="Organizations" value={<CountUp value={totalOrgs} />} />
      <KpiCell label="Paid documents" value={<CountUp value={paidDocs / 1_000_000} decimals={1} suffix=" M" />} />
      <KpiCell label="Payments"       value={<CountUp value={totalPayments / 1_000_000} decimals={1} suffix=" M" />} />
      <KpiCell label="Volume"         value={<CountUp value={totalAmountMld} decimals={0} suffix=" bn CZK" />} />
    </div>
  </Fade>
  <div className="story-scroll-hint">Scroll · ↓</div>
</Section>
```

## Recommendations chapter template

Three (or two, or four) numbered priority cards, gradient-tinted, priority tag on top.

```tsx
{RECOMMENDATIONS.map((r, i) => (
  <Fade key={r.title} delay={(i + 2) as 2 | 3 | 4}>
    <div className={`p-6 md:p-8 rounded-3xl border bg-gradient-to-br ${r.gradient}`}>
      <div className="flex items-start gap-4">
        <div className="text-3xl md:text-4xl font-bold text-white/30 tabular-nums w-12 flex-shrink-0">
          0{i + 1}
        </div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-white/60 mb-2">{r.tag}</div>
          <h3 className="text-xl md:text-2xl font-bold text-white mb-3">{r.title}</h3>
          <p className="text-sm md:text-base text-slate-300 leading-relaxed">{r.description}</p>
        </div>
      </div>
    </div>
  </Fade>
))}
```

## End chapter template

Final push — CTA to Ask Kai or back to top.

```tsx
<Section id="end" minHeight="80vh">
  <div className="text-center">
    <Fade><div className="story-eyebrow mb-6">End of report</div></Fade>
    <Fade delay={1}><h2 className="story-title mb-8" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>Questions?</h2></Fade>
    <Fade delay={2}>
      <p className="story-lead mx-auto mb-12">Ask further in Classic view or via the Ask Kai chat.</p>
    </Fade>
    <Fade delay={3}>
      <div className="flex flex-wrap justify-center gap-4">
        <button onClick={goToAskKai} className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold">
          Open Ask Kai →
        </button>
        <button onClick={() => scrollTo('cover')} className="px-6 py-3 rounded-xl border border-slate-600 text-slate-200 font-medium">
          Back to top
        </button>
      </div>
    </Fade>
  </div>
</Section>
```

## Charts in Story mode

Bigger and less dense than Classic. Wrap in `<ChartExplainer>` the same way. Keep charts within `.story-callout` for consistent borders and blur.

- Area/line charts: `height={320–380}`
- Pie charts: `innerRadius={70}, outerRadius={130}`
- Bar histograms: `height={280}`
- Tooltips: same dark style as Classic

## Ordering rule

Chapters follow **narrative dependency**, not data-source order. If chapter 6 (Complexity) refers to a number that isn't set up until chapter 3 (Methods), swap them. Read the chapter titles out loud in order — they should tell a coherent story to someone with no context.

## Numbers rule

**Every number bigger than 10 000 uses `<CountUp>`, animates on scroll-into-view, and is in tabular-nums.** Do not use `.toLocaleString()` alone for hero numbers — they don't feel alive.

## Empty-state rule

If a chapter's underlying data is missing (e.g., ERP integration data feed is broken), replace the content with a single sentence: "ERP integration data isn't available for this snapshot." Do NOT show empty charts or "—" placeholders. Empty visuals kill trust.
