# Required pages — Documentation + Ask Kai

Two pages are mandatory in every report. Ship without them and users won't know what they're looking at or where to ask.

## Documentation — always the FIRST page

Placement:
- **Classic mode:** leftmost sidebar entry, first tab
- **Story mode:** included as the second chapter (after Cover) OR as an inline "About this report" callout at the top of the Cover

### Required sections

1. **What this report is** (2–4 sentences)
   Who owns it, what question it answers, who the audience is.

2. **Snapshot & refresh cadence**
   When the underlying transformation last ran, how often it refreshes, when to expect the next snapshot.

3. **Data sources** (bullet list)
   Which Keboola buckets / production tables feed each section. Give the FQN so a future analyst can trace it.

4. **Glossary** (2-column table)
   Domain terms specific to this business. List every non-obvious term the report uses and give a one-sentence plain-language definition. Never leak internal DB column prefixes here.

5. **How to read the charts**
   One paragraph pointing the reader to the ⓘ icon on each chart. Establishes the pattern early so they know what to click.

6. **Known limitations** (bulleted)
   Every LIMIT in the pre-agg transformations, every excluded segment, every currency conversion caveat. This is where transparency lives.

7. **Who to ping**
   Data owner + product owner + a Slack channel. Named humans, not team aliases — "reports.acc-payment @ #data-analytics".

### Template

```tsx
export function DocumentationPage({ data }: { data: DataResponse }) {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">📖 Documentation</h1>
        <p className="text-sm text-slate-400">Everything you need to trust the numbers in this report.</p>
      </div>

      <section className="insight-card">
        <h3 className="insight-headline">What this report is</h3>
        <p className="text-sm text-slate-300 leading-relaxed">…</p>
      </section>

      <section className="insight-card">
        <h3 className="insight-headline">Snapshot &amp; refresh</h3>
        <p className="text-sm text-slate-300">
          Last snapshot: <strong>{new Date(data.snapshotAt).toLocaleString()}</strong><br />
          Refresh cadence: <em>e.g. every 6 hours</em>, via <code>{TRANSFORMATION_NAME}</code>.
        </p>
      </section>

      <section className="insight-card">
        <h3 className="insight-headline">Data sources</h3>
        <ul className="text-sm text-slate-300 space-y-1 list-disc pl-5">
          {/* EDIT: list your bucket + producer table FQNs so a future analyst can trace them. */}
          <li><code>out.c-&lt;your-bucket&gt;.ACC_*</code> — pre-aggregated tables, all sections read from here</li>
          <li><code>out.c-&lt;bdm-layer&gt;.&lt;source-table&gt;</code> — canonical source</li>
        </ul>
      </section>

      <section className="insight-card">
        <h3 className="insight-headline">Glossary</h3>
        <table className="data-table">
          <tbody>
            {/* EDIT: list every non-obvious term used in the report. See copy-guide.md for rules. */}
            <tr><td><strong>&lt;Term A&gt;</strong></td><td>One-sentence plain-language definition.</td></tr>
            <tr><td><strong>&lt;Term B&gt;</strong></td><td>…</td></tr>
          </tbody>
        </table>
      </section>

      <section className="insight-card">
        <h3 className="insight-headline">Known limitations</h3>
        <ul className="text-sm text-slate-300 space-y-2 list-disc pl-5">
          {/* EDIT: every LIMIT in the pre-agg SQL, every excluded segment, every currency-conversion caveat. */}
          <li>Detail drill-down tables cap at 10 000 rows. Hero counts come from a separate KPI table and are the true totals.</li>
          <li><em>List app-specific exclusions and known data-quality filters here.</em></li>
        </ul>
      </section>

      <section className="insight-card">
        <h3 className="insight-headline">Who to ping</h3>
        <p className="text-sm text-slate-300">
          Data / report owner: <strong>your.name@example.com</strong><br />
          Product owner: <strong>product@example.com</strong><br />
          Slack: <strong>#data-analytics</strong>
        </p>
      </section>
    </div>
  );
}
```

### Story-mode compact version

In Story mode, don't dump the whole documentation as chapter 2 — it kills momentum. Instead include a short callout at the bottom of the Cover chapter linking to Classic mode's Documentation, and put "known limitations" as an appendix chapter before Recommendations.

## Ask Kai — always the LAST page

Placement:
- **Classic mode:** rightmost sidebar entry, last tab
- **Story mode:** the End chapter CTA points to Ask Kai

### Implementation

Copy `AskKaiPage.tsx` from `keboola-js-dataapp-boilerplate/references/AskKaiPage.tsx`. That component uses the polling flow (not SSE — SSE drops mid-response in the Keboola ingress; see boilerplate `pitfalls.md` §1).

### Prerequisites

- `STORAGE_API_TOKEN` secret set in **Data App → Advanced Settings → Secrets** (Full Access token). Without it, `KBC_TOKEN` alone returns 403 against `kai-assistant`.
- Server routes `/api/chat/start` and `/api/chat/poll` from the boilerplate `server-index.ts`.

### Recommended prompt hints (starter suggestions)

At the top of the empty Ask Kai chat, show 3–4 clickable example questions specific to the app's data. Otherwise users freeze on the empty input. Good starters are questions where Kai will answer with a small table + a citation to a specific `ACC_*` table:

```tsx
// EDIT: 3–4 domain-specific questions your users would actually ask.
const KAI_SUGGESTIONS = [
  'Which 5 <entities> have the largest share of <behavior>?',
  'What is the trend of <metric> over the last 12 months?',
  'How many <records> had <event> last quarter?',
  'Which <segment> correlates with the fastest <outcome>?',
];
```

Render these as clickable pill buttons that, when clicked, submit the question directly.

### Dashboard context for Kai

The boilerplate server prepends a `[Dashboard context: ...]` string to the first message of each conversation, telling Kai which app the user is in and which tables it reads. Edit the `KAI_APP_CONTEXT` constant in `server-index.ts` for your app:

```ts
// EDIT: describe the app, its data location, and the desired reply style.
const KAI_APP_CONTEXT =
  'User is in <Your App Name> (config <configuration_id>). ' +
  'Data comes from <bucket FQN> (tables ACC_*). ' +
  'Producer transformation: <transformation_id>. ' +
  'Reply concisely; quote source tables/columns for every number.';
```

### Fallbacks

- If `STORAGE_API_TOKEN` is missing → the server returns 500 with an actionable error message ("Ask Kai is not configured. Data App → Advanced Settings → Secrets → add STORAGE_API_TOKEN…"). The frontend displays that message verbatim in the chat bubble.
- If Kai upstream returns 403 → the server includes a hint ("STORAGE_API_TOKEN likely missing Full Access") in the error message.
- If Kai upstream returns 400 with `branchId` validation error → this indicates the `body.branchId` isn't a number. The boilerplate `makeChatBody` handles this; if you customized it, check `pitfalls.md` §3.
