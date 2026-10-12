/**
 * Fixed bottom navigation — the app's primary way around.
 * Tabs: Score (live game), History, Stats (global analytics), More.
 */
const TABS = [
  {
    key: 'home',
    label: 'Score',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
      </svg>
    ),
  },
  {
    key: 'history',
    label: 'History',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 14" />
      </svg>
    ),
  },
  {
    key: 'stats',
    label: 'Stats',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="20" x2="5" y2="12" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="19" y1="20" x2="19" y2="9" />
        <line x1="3" y1="20" x2="21" y2="20" />
      </svg>
    ),
  },
  {
    key: 'more',
    label: 'More',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="9.2" />
      </svg>
    ),
  },
]

export default function BottomNav({ view, onNavigate }) {
  // Sub-pages (players) highlight the tab that owns them.
  const activeKey = view === 'players' ? 'more' : view

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {TABS.map(t => (
        <button
          key={t.key}
          type="button"
          className={`bottom-nav-item ${activeKey === t.key ? 'active' : ''}`}
          onClick={() => onNavigate(t.key)}
        >
          <span className="bottom-nav-icon">{t.icon}</span>
          <span className="bottom-nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
