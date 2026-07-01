# Copy guide — voice, tone, terminology

The report reads well not because it uses fancy words, but because it's consistent. Same term everywhere. Same tense. Same person. The tiny decisions add up.

## Voice

- **Direct, not academic.** "Method X is used by 3.2 % of payments." NOT "It could be observed that the utilization of method X…"
- **Present tense.** Everything the app shows is a live snapshot. Say "processes", "uses", "runs". Not "processed", "was used", "ran".
- **Third person, no "we".** The report is describing the platform, not what "we" do. NOT "we found that…" YES "the data shows that…"
- **No hedging.** "About 100 000 records" → "101 228 records". If you can't be exact, don't estimate — leave it out or use a range.

## Numbers

- Always thousands separators, locale-appropriate. Czech uses non-breaking spaces (`1 234 567`). Never bare `1234567`.
- Percentages: 1 decimal for hero, 0 decimals for lists. "3.2 %" for a hero KPI, "3 %" in a table row.
- Currency: use short units for large values (`bn`, `mil`, `tis` in CZ; `B`, `M`, `K` in EN). Never plain digits with a currency suffix for large amounts — nobody reads `188 700 000 000 Kč`.
- Compact for chart labels: `4.1M`, `95K`. Full for hero KPIs.
- Use `<CountUp>` for hero animations. Do NOT use `<CountUp>` for values in tables or captions (visual jitter without payoff).

## Domain terminology — build the app's glossary FIRST

Before writing any copy, produce a two-column glossary of every domain term the report will use. Put it in the Documentation page (see `required-pages.md`) and stick to it everywhere else.

Template — fill for your specific domain:

| Domain concept | Report term (EN) | Report term (localized) | Never say |
|---|---|---|---|
| `<internal DB name>` | `<user-facing English>` | `<localized version>` | `<internal codes / abbreviations>` |
| … | … | … | … |

**Rules for the glossary:**
- Never leak internal DB column prefixes (`DPM_`, `DIM_`, `FCT_`, `SCD_`, etc.) into user-facing copy. Ever. They exist for engineers, not for the board.
- Proper nouns (product names, integration names like "Bank API", "Salesforce", "HubSpot") stay in their original form and are not translated.
- Pick ONE term per concept and use only that term. If two synonyms exist internally, choose the one your stakeholders already say out loud.

## Do / don't examples

### Chart title

- ❌ **"ACC_METRIC_BY_METHOD grouped by method_column"** — SQL leak
- ❌ **"Methods"** — too vague
- ✅ **"Payments by method — direct vs API"**

### Hero headline

- ❌ **"Method X adoption is a marginal 3.2 %"** — editorializing
- ❌ **"96.8 % of records are processed without method X"** — passive + double negative
- ✅ **"96.8 % of records skip method X"** — direct, one clear fact

### Recommendation

- ❌ **"We should consider improving the onboarding funnel"** — hedges, uses "we"
- ✅ **"Prioritize onboarding for method X. Each 1 percentage point of adoption means ~40 000 additional automated events per year."** — direct, quantified

### Caveat

- ❌ **"Note: data may not be complete for all months due to various sources of missingness"** — vague
- ✅ **"Data from before January 2023 is excluded — the platform had limited adoption then and rows are incomplete."**

## Titles per chapter / page

Chapter titles in Story mode should be complete sentences, not noun phrases:

- ❌ "Payment methods"
- ✅ "96.8 % of payments skip the API integration."

- ❌ "Workflow adoption"
- ✅ "Most users don't use the recommended workflow."

- ❌ "Data quality"
- ✅ "Where data smells: 101 228 outliers and 61 711 orphan records."

## Emojis

- Sidebar tab icons: **use lucide-react icons**, not emoji. Consistent size, accessible.
- Section eyebrows and Docs page headers: emoji is OK (📖, 📊, 💰) — helps scanning.
- Chart labels and hero copy: **no emoji**. Distracts from the number.
- Recommendations: **no emoji**. Priority number ("01", "02") tells the reader all they need.

## Length limits (soft)

- Chapter title: ≤ 12 words
- Chapter lead paragraph: ≤ 3 sentences
- InsightCard headline: ≤ 15 words
- InsightCard meaning: ≤ 2 sentences
- InsightCard recommendation: ≤ 2 sentences
- ChartExplainer "how to read": ≤ 2 sentences
- ChartExplainer "where the number comes from": ≤ 3 sentences

If you can't fit under these limits, rewrite. Usually the sentence is doing 2 jobs and one can be dropped.

## Language selection

If the audience mixes native speakers of multiple languages, pick the **dominant** language and stick to it. Do NOT mix — a half-and-half report is worse than either. The exceptions are proper nouns (product names, tool names) which stay in their original form.

## The final voice test

Read the finished chapter title, hero KPI card, and one ChartExplainer out loud to someone from outside the team (partner, non-technical friend). If they can restate what the number means, ship it. If they ask "what's a `<something>`" — either that term is in your glossary (add it) or replace it.
