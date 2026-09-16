---
name: keboola-js-dataapp-design
description: Design system + component library for Keboola JS data apps built with React + Vite + TypeScript. Ships two report modes — Classic (tabbed report for analytical work) and Story (single-scroll narrative for board presentations) — with a mode selector on first load. Enforces the rules that make a data app immediately usable — Documentation as the first page, Ask Kai as the last, and every chart wrapped in a "how to read + where the number comes from" explainer in plain language (not SQL). Provides the CSS design tokens, InsightCard / HeroKpi / DataTable / ChartExplainer components, and dramaturgical structure for the Story mode. Trigger phrases — "design a Keboola data app", "add a story mode", "make the report look premium", "why is my chart missing an explainer", "board-ready dashboard". Companion skill — `keboola-js-dataapp-boilerplate` for infrastructure, server, and Kai integration.
metadata:
  version: "1.0.0"
  author: pstepanek
---

# Keboola JS Data App — Design

**What this produces:** a dark-themed, premium-feel React data app with a mode selector on first load (Classic tabs vs Story scroll), enforced Documentation and Ask Kai tabs, animated hero KPIs, and every chart accompanied by a "how to read" explainer that reads like a caption in a newspaper — not like SQL.

**Requires:** the infrastructure skeleton from `keboola-js-dataapp-boilerplate`. This skill is the layer on top.

## Companion skills

- **`keboola-js-dataapp-boilerplate`** — repo layout, Express server, Kai polling, Snowflake helper, pitfalls. Invoke first.
- **`keboola-storage-query`** — SQL patterns for the transformations that feed the app.

## The seven non-negotiables

1. **Classic mode only by default — do NOT build Story mode unless the user explicitly asks for it.** No mode selector, no landing screen, no Story components generated speculatively. If the user later asks for "story mode" / "board view" / "presentation mode", add it then (see `references/mode-selector.md` and `references/story-mode.md`) and only then wire up the selector + `localStorage['<app-slug>-view-mode']` persistence.
2. **Documentation tab is always first.** Both in Classic (leftmost tab) and Story (opening chapter). It explains what the app shows, where the data comes from, what any domain-specific terms mean in this app's context, and who to ping if numbers look off.
3. **Ask Kai tab is always last.** Free-form question-and-answer over the app's data. Uses the polling flow from the boilerplate skill.
4. **Every chart is wrapped in `<ChartExplainer>`.** No raw `<BarChart>` in a page — it always sits inside a wrapper that has an ⓘ / ? affordance. The panel reveals two paragraphs: "how to read this" and "where the number comes from" — both in plain language, no SQL.
5. **Hero numbers animate on scroll-into-view.** Not on page load — animation ties to reading pace.
6. **Colors are semantic, not decorative.** Danger red = data quality issues or risks. Success emerald = healthy patterns. Warning amber = adoption gaps. Primary indigo/purple = neutral data.
7. **Every KPI card has the same height.** Enforce with `min-height` — otherwise mixed content produces a ragged grid that looks amateurish on the board projector.

## Reference files

- `references/index.css` — full CSS block (design tokens + all component classes). Copy verbatim to `src/index.css`.
- `references/components.md` — `InsightCard`, `HeroKpi`, `MiniKpi`, `DataTable`, `ChartExplainer`, plus the `CountUp` and `Fade` primitives.
- `references/classic-mode.md` — tab-based report structure and templates.
- `references/story-mode.md` — dramaturgical arc for the single-scroll presentation.
- `references/chart-explainer.md` — how to write the "how to read" copy so it works for a CFO.
- `references/required-pages.md` — Documentation and Ask Kai templates.
- `references/mode-selector.md` — landing screen code + localStorage handling.
- `references/copy-guide.md` — voice, tone, and terminology (Czech + English variants).

## The design tokens (short version)

```css
--brand-primary: #5B6CFF;   /* neutral indigo — hero KPIs, most bars */
--brand-accent:  #8B5CF6;   /* gradient partner for primary */
--brand-success: #10B981;   /* healthy adoption, on-time payments */
--brand-warning: #F59E0B;   /* attention: adoption gaps, aging orders */
--brand-danger:  #EF4444;   /* data quality bugs, risks, hard failures */
--brand-muted:   #64748B;   /* muted secondary text */

/* Story mode uses lighter gradient endpoints against a darker background: */
--story-hero-a: #A5B4FC;
--story-hero-b: #C4B5FD;
--story-hero-c: #F5D0FE;
```

Background is always a subtle radial-gradient-blur combo — never a flat color. See `references/index.css`.

## Fonts

Inter loaded from Google Fonts with `font-feature-settings: "ss01", "cv11"; font-variant-numeric: tabular-nums;` on any numeric element. Tabular nums prevent jitter as `CountUp` animates.

## Structure at page level

**Default — Classic mode only:**
```
Documentation (mandatory first) → Feature tab 1 → Feature tab 2 → … → Ask Kai (mandatory last)
```
Sidebar navigation, one insight per card, cards stacked vertically inside a `max-w-4xl` container. No mode selector, no Story code.

**Story mode — only when the user asks for it:**
```
Cover → Documentation (opening chapter, condensed) → Chapter 1 → … → Recommendations → End (Ask Kai link)
```
Full-viewport chapters, right-side progress dots, scroll-triggered animations. See `references/story-mode.md` for the dramaturgical arc pattern, and `references/mode-selector.md` for wiring the landing screen + `localStorage` persistence once Story is actually requested.

## The `<ChartExplainer>` rule

**Every chart, no exception:**

```tsx
<ChartExplainer
  howToRead="Each bar is the share of payments made within that time bucket. Longer bars = more payments landed in that window."
  dataSource="Computed from timing between the 'Mark for payment' click and the actual bank transfer date, for every payment in the last 24 months."
  caveat="Rows where the payment timestamp is missing (~2 % of rows) are excluded."
>
  <ResponsiveContainer …>
    <BarChart …>…</BarChart>
  </ResponsiveContainer>
</ChartExplainer>
```

Copy rules:
- "How to read" = **max 2 sentences**, uses everyday words. Never mentions SQL, columns, or tables.
- "Where the number comes from" = **max 3 sentences**, describes the logic in terms of what the platform does. Reader is a director of finance, not an engineer.
- "Caveat" is optional — use for known gotchas (excluded rows, LIMITed detail, sampling, currency conversion coverage).

See `references/chart-explainer.md` for good vs bad examples.

## Pre-ship checklist for the design

- [ ] Story mode was NOT built unless the user explicitly asked for it — Classic only by default, no landing selector
- [ ] Documentation is the leftmost tab in Classic (and the opening chapter in Story, if built)
- [ ] Ask Kai is the rightmost tab in Classic (and end-of-scroll CTA in Story, if built)
- [ ] Every chart is inside `<ChartExplainer>` with non-SQL copy
- [ ] Hero numbers use `<CountUp>` and animate on scroll-into-view, not on load
- [ ] KPI cards in a row have equal min-height (add `<div>&nbsp;</div>` spacer if the delta is optional)
- [ ] Colors are semantic — no red "just because" and no rainbow palettes
- [ ] If Story mode was built: chapters ORDER dramaturgically (context → pattern → conflict → resolution), not by data importance
- [ ] Every LIMITed pre-agg table has either a KPI count exposing the true total, OR a caveat in the ChartExplainer
- [ ] Tabular numbers use `font-variant-numeric: tabular-nums`
- [ ] `Inter` font is loaded (Google Fonts) and used everywhere
- [ ] Dark background is the radial-gradient combo, not `#000` or `#111`
