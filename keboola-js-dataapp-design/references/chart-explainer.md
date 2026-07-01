# Writing chart explainers

Every `<ChartExplainer>` has two required paragraphs and one optional. The board / CFO / product manager reads them without you being in the room. If they don't understand what the chart shows or where the number came from, the chart is decoration.

## The rule

- **How to read** — max **2 sentences**. Uses everyday words. Never mentions SQL, columns, tables, joins, transformations.
- **Where the number comes from** — max **3 sentences**. Describes the logic in terms of what the platform does, not how the pipeline works.
- **Caveat** — optional, only when a real gotcha exists (LIMITed detail table, sampled data, missing rows, currency conversion coverage).

## Voice test

If you can read the explainer to a non-technical stakeholder and they nod, ship it. If they ask "what's a `<domain code>`" or "what's Snowflake", rewrite.

## Good examples

### Bar chart of time-to-pay buckets

**How to read**
> Each bar is a slice of payments grouped by how many days passed between "Mark for payment" and the actual bank transfer. The higher the bar, the more payments landed in that time bucket.

**Where the number comes from**
> Every recorded payment carries two timestamps — when the user clicked "Mark for payment" and when the money actually moved. We compute the difference in days and group payments into buckets (same day, 1 day, 2–7 days, and so on).

**Caveat**
> Payments where either timestamp is missing (~2 % of records, usually very old rows) are excluded.

### Multi-installment histogram (generic pattern)

**How to read**
> Each bar shows how many records were split into exactly that many installments. Most bars point to "2" — most partial workflows are just one advance and one final step.

**Where the number comes from**
> Every child event is linked to a parent record. We count how many children each parent has, then group parents into installment-count buckets.

## Bad examples (rewrite these)

### Bad: mentions SQL

> How to read: **This chart plots the result of a GROUP BY on `PAYMENT_METHOD` in `ACC_PAYMENT_BY_METHOD`.**

Rewrite:
> Each slice is one payment method — Bank API, mark-then-pay, manual bank entry, or automatic reader pairing. The bigger the slice, the more payments went through that method.

### Bad: too many caveats up front

> How to read: The chart shows Bank API adoption but only counts payments after 2023 because before that the data was unreliable and…

Rewrite (move the caveat down):
> Each bar is the share of payments made through the direct Bank API integration.
>
> Caveat: Only payments from 2023 onward are counted — earlier records are incomplete.

### Bad: passive voice, jargon

> How to read: Payment records are aggregated by month and the sum of amounts is displayed.

Rewrite:
> Each column is a month. Its height is the total value of all payments processed that month, in billions of CZK.

## Sourcing template

For any chart, ask three questions and answer them in one sentence each:

1. **What are we counting?** (payments? documents? users? organizations?)
2. **What are we grouping by?** (by month? by method? by size?)
3. **Are we excluding anything?** (specific timeframe, specific method, known-bad rows?)

If the third answer is "yes, and it matters" → put it in the caveat. If "yes, but harmless" → skip the caveat.

## Language

Match the report language. Use the localized term for every domain concept — do not mix Anglicisms into a localized report unless a term is a proper noun (product names, integration names). See `copy-guide.md` for how to build the app's glossary and the terminology rules.

## Editing pass

Before shipping any chart:

- [ ] Read the "how to read" out loud. Longer than 2 sentences? Cut.
- [ ] Read the "where the number comes from" out loud. Longer than 3 sentences? Cut.
- [ ] Does anything in the copy assume the reader knows SQL or the schema? Rewrite in end-user terms.
- [ ] Are there hidden caveats (a `LIMIT` in the source table, a filtered date range, an excluded segment)? Add a caveat.
- [ ] Numbers that appear in the copy (e.g. "94 % of payments") — are they computed live, or hardcoded? If hardcoded, delete them.
