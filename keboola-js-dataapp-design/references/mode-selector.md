# Mode selector — landing screen

First time a user opens the app they see a two-card landing that asks: Classic or Story? The choice is saved to `localStorage` under the app's slug. Next visit skips the landing and opens the last-chosen mode.

Every page (both modes) exposes a small "switch to the other mode" affordance:
- Classic → bottom of sidebar (`Switch to Story mode` gradient button)
- Story → floating pill in the top-right corner (`story-mode-switcher` class)

## Copy

- **Classic**: "The full report. Sidebar with all sections, one insight per card. Recommended for analytical work and drill-down."
- **Story**: "A guided narrative. Single scroll, one big idea per screen. Recommended for board and stakeholder review." Tag it "NEW" the first month so returning users notice it exists.

## Component

```tsx
import { LayoutDashboard, Sparkles, ArrowRight } from 'lucide-react';

type ViewMode = 'classic' | 'story';

function ModeSelect({ onPick }: { onPick: (mode: ViewMode) => void }) {
  return (
    <div className="mode-select-body">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <div className="story-eyebrow mb-4">{APP_NAME}</div>
          <h1 className="story-title mb-4" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
            How do you want to see the data?
          </h1>
          <p className="story-lead mx-auto">Pick a view. You can switch anytime.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button onClick={() => onPick('classic')} className="mode-card text-left group">
            <div className="mode-card-icon"><LayoutDashboard size={24} className="text-white" /></div>
            <h3 className="text-xl font-bold text-white mb-2">Classic report</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              Sidebar with all sections, one insight per card. Recommended for analytical work and drill-down.
            </p>
            <div className="flex items-center gap-2 text-xs text-indigo-300 font-medium">Open <ArrowRight size={12} /></div>
          </button>

          <button onClick={() => onPick('story')} className="mode-card text-left group">
            <div className="mode-card-icon" style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)' }}>
              <Sparkles size={24} className="text-white" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">
              Story mode
              <span className="ml-2 px-2 py-0.5 text-[10px] tracking-wider bg-purple-500/20 text-purple-300 rounded-full uppercase align-middle">New</span>
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              A guided narrative. Single scroll, one big idea per screen. Recommended for board and stakeholder review.
            </p>
            <div className="flex items-center gap-2 text-xs text-purple-300 font-medium">Open <ArrowRight size={12} /></div>
          </button>
        </div>
      </div>
    </div>
  );
}
```

## Persistence

Use a **per-app slug** in the `localStorage` key so multiple apps on the same domain don't overwrite each other:

```tsx
const APP_SLUG = '<your-app-slug>'; // e.g. 'payment-analytics', 'sales-dashboard'
const STORAGE_KEY = `${APP_SLUG}-view-mode`;

export function App() {
  const [mode, setMode] = useState<ViewMode | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'classic' || stored === 'story' ? stored : null;
    } catch { return null; }
  });

  const pickMode = (m: ViewMode) => {
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* ignore quota errors */ }
    setMode(m);
  };

  if (loading) return <LoadingScreen />;
  if (error || !data) return <ErrorScreen error={error} />;
  if (mode === null) return <ModeSelect onPick={pickMode} />;
  if (mode === 'story') return <StoryPage data={data} onExitStory={() => pickMode('classic')} />;
  return <ClassicShell data={data} onSwitchToStory={() => pickMode('story')} />;
}
```

## Deep-link override (optional)

Support `?mode=story` in the URL for demoing to stakeholders without them having to click through the selector:

```tsx
const [mode, setMode] = useState<ViewMode | null>(() => {
  const params = new URLSearchParams(window.location.search);
  const urlMode = params.get('mode');
  if (urlMode === 'classic' || urlMode === 'story') return urlMode;
  try { return (localStorage.getItem(STORAGE_KEY) as ViewMode) || null; } catch { return null; }
});
```

## "Change my mind" button

If a user picked Story mode by mistake and can't find Classic — the floating pill in the top-right corner of Story mode says "Classic view" and switches back immediately (no landing screen re-shown).

Symmetric on Classic side: the sidebar bottom pill says "Switch to Story mode".

Never delete the persisted choice on switch — just overwrite it. Users cycle both directions naturally over the life of a report.

## Reset for testing

During development, clear the choice via DevTools:

```js
localStorage.removeItem('<your-app-slug>-view-mode')
```

Or add a hidden dev-only reset button (only rendered when `import.meta.env.DEV`) in the sidebar footer for faster iteration.
