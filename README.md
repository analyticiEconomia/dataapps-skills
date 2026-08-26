# dataapps-skills

Claude Code skills for building **Keboola JS data apps** — React + Vite + TypeScript apps with an Express backend, Kai chat integration, and a two-mode UI (Classic tabbed report + Story-mode narrative).

`boilerplate` and `design` are generic and reusable across any Keboola project and domain. `economia-dataapp-google-group-access` is Economia-specific (org contacts, 1Password entry names).

## What's inside

### [`keboola-js-dataapp-boilerplate/`](./keboola-js-dataapp-boilerplate)

Infrastructure: how to provision the data app on Keboola, clone its managed git repo, scaffold Express + Snowflake + Kai polling, and ship.

- `SKILL.md` — 7-step workflow with pre-flight checklist
- `references/scaffold.md` — package.json, tsconfigs, Vite, Tailwind, nginx, supervisord configs
- `references/server-index.ts` — full Express server template (Kai polling proxy + Snowflake helper)
- `references/server-kbcQuery.ts` — Snowflake query wrapper (with correct `pageSize` default of 50 000)
- `references/AskKaiPage.tsx` — React polling client, SSE parser (`delta` field, not `textDelta`), icon post-processor
- `references/data-flow.md` — Snowflake pre-agg pattern (KPI + detail + buckets tables)
- `references/pitfalls.md` — **20 mistakes** learned the hard way — read before shipping

### [`keboola-js-dataapp-design/`](./keboola-js-dataapp-design)

Visual system: two report modes with a first-load selector, mandatory Documentation and Ask Kai tabs, and a `<ChartExplainer>` wrapper enforcing "how to read + where the number comes from" on every chart in plain language.

- `SKILL.md` — 7 non-negotiables + pre-ship checklist
- `references/index.css` — full CSS token block + all component classes (Classic + Story)
- `references/components.md` — `<ChartExplainer>`, `<InsightCard>`, `<HeroKpi>`, `<CountUp>`, `<Fade>`, `<DataTable>`
- `references/mode-selector.md` — landing screen + `localStorage` persistence + `?mode=story` deep-link
- `references/classic-mode.md` — sidebar tab layout template
- `references/story-mode.md` — 5-act dramaturgical arc + chapter templates + progress dots
- `references/chart-explainer.md` — good/bad copy examples for the chart explainers
- `references/required-pages.md` — Documentation (first tab) + Ask Kai (last tab) templates
- `references/copy-guide.md` — voice, tone, terminology template (per-app glossary)

### [`economia-dataapp-google-group-access/`](./economia-dataapp-google-group-access)

Add-on: gate an already-built data app behind Google SSO + a specific Google Group, on top of the boilerplate above. Economia-specific (shared credentials in 1Password "Keboola JS Apps Auth", IT contact, group-naming convention).

- `SKILL.md` — per-app checklist: pick/request the Google Group, wire the OAuth redirect URI, add secrets, drop in the middleware
- `references/middleware.ts` — Express gate using the Cloud Identity Groups API (no domain-wide delegation needed)
- `references/group-request-email.md` — email template for Economia IT (new group and/or new OAuth redirect URI)

## Installation

### Global (all Claude Code sessions)

```bash
git clone https://github.com/analyticiEconomia/dataapps-skills.git ~/.claude/skills-dataapps
# OR copy the two folders into ~/.claude/skills/
cp -r ~/.claude/skills-dataapps/keboola-js-dataapp-* ~/.claude/skills/
```

### Per-project

Drop either folder into your project under `.claude/skills/<skill-name>/`.

## Trigger phrases

Once installed, Claude Code picks up these skills when you say:

- "new Keboola JS data app"
- "add Kai chat to a data app"
- "why is my chart showing exactly 10 000 rows"
- "why does Ask Kai drop mid-response"
- "add a story mode"
- "make the report look premium"
- "why is my chart missing an explainer"

Or invoke explicitly:

```
Use keboola-js-dataapp-boilerplate to scaffold a new payment dashboard.
```

## Why two skills

`boilerplate` is the mechanical foundation — copyable code and a fixed workflow. It changes rarely.

`design` is the interpretive layer — mode selector, visual system, dramaturgy of the narrative report, chart explainers. It's where you'd customize for your brand.

They cross-reference each other — invoking one surfaces the other as a companion.

## License

Public domain / CC0. Fork and adapt for your team.

## Credits

Distilled from a real Keboola build. Every pitfall is documented — read `pitfalls.md` before shipping to save yourself the debugging.
