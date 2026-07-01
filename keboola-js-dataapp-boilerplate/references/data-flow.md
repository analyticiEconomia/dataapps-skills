# Data flow — Snowflake pre-agg pattern

This is the shape every well-behaved Keboola data app follows:

```
Raw data (production DB extractor, BDM, DWH…)
      │
      ▼
[PROD] <feature> — Pre-aggregates    ← Snowflake transformation
      │  Reads raw tables, writes small ready-made metric tables:
      │    - ACC_<feature>_KPIS         (1 row, all hero counts)
      │    - ACC_<feature>_BY_<dim>     (small rollups: 10–200 rows)
      │    - ACC_<feature>_<detail>     (top-N drill-down: LIMIT 10 000 typical)
      │    - ACC_<feature>_<buckets>    (histograms: 5–10 rows, NEVER limited)
      ▼
out.c-metrics_v2.ACC_<feature>_*      ← Storage bucket
      │
      ▼
Data app queryTable('ACC_<feature>_KPIS') …   ← SELECT * from each metric table
      │
      ▼
React Story/Classic pages
```

## Why this shape

1. **The data app never aggregates at request time.** Loading time = round-trip × N small `SELECT *` queries, no compute.
2. **Hero counts always come from the KPI table**, not from `detail_table.length`. Detail tables often carry `LIMIT N` for drill-down UX; using their length as a count silently truncates.
3. **Histograms come from dedicated bucket tables**, not from client-side reduction of a `LIMIT`ed detail table. `.filter(x => x.n === 2).length` on a top-10K-by-severity detail is wildly biased.

## The KPI table pattern

One row, dozens of columns. Every KPI card in the app reads from here.

```sql
CREATE OR REPLACE TABLE "ACC_<feature>_KPIS" AS
WITH stale AS (…), overpaid AS (…), timing AS (…)
SELECT
  (SELECT COUNT(*) FROM "IN_TABLE")                          AS total_rows,
  (SELECT COUNT(DISTINCT "ORG_ID") FROM "IN_TABLE")          AS distinct_orgs,
  (SELECT n FROM overpaid)                                   AS overpaid_docs_count,
  (SELECT median FROM timing)                                AS median_days,
  -- Add EVERY count the frontend needs, even if you only use one card today.
  -- Adding one later is a config edit + re-run; not doing it now leaves
  -- the frontend guessing table.length.
  CURRENT_TIMESTAMP()                                        AS snapshot_at;
```

Snapshot: `CURRENT_TIMESTAMP()` returns Unix epoch **seconds**. Convert on the server before sending to the frontend (see `pitfalls.md` §8).

## The detail-table pattern (top-N drill-down)

Used to power UI tables where users drill into anomalies. Always ordered, always limited:

```sql
CREATE OR REPLACE TABLE "ACC_<feature>_OVERPAID" AS
WITH agg AS (…)
SELECT *
FROM agg
WHERE overpayment_ratio > 1.01
ORDER BY overpayment_amount DESC
LIMIT 10000;
```

Rules for detail tables:
- Always `ORDER BY` before `LIMIT`. Random top-N is worthless.
- Document the LIMIT in the transformation description AND in this data-flow doc.
- Expose the true `COUNT(*)` as a separate KPI column (see above).

## The histogram-table pattern

Small, unlimited. One row per bucket.

```sql
CREATE OR REPLACE TABLE "ACC_<feature>_MULTI_LINE_ITEMS_BUCKETS" AS
WITH per_doc AS (
  SELECT "DOC_ID", COUNT(*) AS n_items FROM "IN_LINE_ITEMS"
  WHERE "DOC_ID" IS NOT NULL
  GROUP BY "DOC_ID" HAVING COUNT(*) >= 2
)
SELECT
  CASE
    WHEN n_items = 2 THEN '2'
    WHEN n_items = 3 THEN '3'
    WHEN n_items = 4 THEN '4'
    WHEN n_items = 5 THEN '5'
    WHEN n_items BETWEEN 6 AND 10 THEN '6-10'
    ELSE '11+'
  END AS bucket,
  MIN(n_items) AS min_items,     -- sort key
  COUNT(*)  AS n_docs
FROM per_doc
GROUP BY 1
ORDER BY MIN(n_items);
```

Frontend reads it directly:

```ts
const bucketMap = new Map<string, number>();
data.multiLineItemsBuckets.forEach((b) => bucketMap.set(String(b.BUCKET), Number(b.N_DOCS)));
const chartData = ['2', '3', '4', '5', '6-10', '11+'].map((k) => ({
  bucket: k,
  n: bucketMap.get(k) || 0,
}));
```

## Storage output mapping is not automatic

Every `CREATE OR REPLACE TABLE "ACC_<something>" AS …` block only creates the table in the workspace. To export it to the Storage bucket you MUST add it to `storage.output.tables` in the transformation config:

```json
{
  "source": "ACC_<something>",
  "destination": "out.c-metrics_v2.ACC_<something>",
  "primary_key": ["ID"]
}
```

Miss this and `SELECT * FROM out.c-metrics_v2.ACC_<something>` returns "object does not exist" while your job runs green. See `pitfalls.md` §15.

## Naming convention

- `ACC_` prefix — "Analytics Core" pre-agg tables for `<feature>` data app
- `<feature>` — short domain slug: `PAYMENT`, `BANK_TX`, `EXPENSE_TX`, `INVOICE`…
- Suffix meaning:
  - `_KPIS` → single-row headline table
  - `_BY_<dim>` → rollup by dimension (`_BY_METHOD`, `_BY_MONTH`, `_BY_ORG`)
  - `_<detail>` → drill-down list (`_OVERPAID`, `_STALE_ORDERS`)
  - `_BUCKETS` → histogram (dedicated for chart)
  - `_PER_ORG` / `_PER_IDENTITY` → per-entity rollup
- Column naming: `SCREAMING_SNAKE_CASE`; `N_<something>` for counts, `PCT_<something>` for percentages, `SUM_<something>_CZK` for currency totals in CZK.
