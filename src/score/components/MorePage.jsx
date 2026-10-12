import { Users, Pencil, Trash2, Handshake, Spade } from 'lucide-react'
import { getTheme } from '../utils/themes'

/**
 * The "More" tab: player management, preferences, season controls and a
 * small about card.
 */
export default function MorePage({
  onOpenPlayers,
  soundEnabled,
  onToggleSound,
  darkMode,
  onToggleDark,
  seasonName,
  seasonTheme,
  onEditSeason,
  onResetGame,
}) {
  const ThemeIcon = getTheme(seasonTheme).Icon

  return (
    <div className="more-page">
      <div className="card">
        <h2>Players</h2>
        <p className="more-hint">Add or remove the people who play at your table.</p>
        <button className="primary icon-btn" onClick={onOpenPlayers}><Users size={15} /> Manage Players</button>
      </div>

      <div className="card">
        <h2>King Online</h2>
        <p className="more-hint">Play live games and see the online leaderboard.</p>
        {/* King Online is the site's home page (its own root layout) */}
        <button className="primary icon-btn" onClick={() => window.location.assign('/')}><Spade size={15} /> Open King Online</button>
      </div>

      <div className="card">
        <h2>Current Season</h2>
        <div className="more-season-row">
          <span className="more-season-chip">
            <ThemeIcon size={15} /> {seasonName || 'Unnamed season'}
          </span>
          <button className="link icon-btn" onClick={onEditSeason}><Pencil size={12} /> Rename / theme</button>
        </div>
        <p className="more-hint">
          Ending a season happens from History → the “End Season” button (PIN protected).
        </p>
      </div>

      <div className="card">
        <h2>Preferences</h2>
        <div className="more-toggle-row">
          <div>
            <strong>Sounds</strong>
            <p className="more-hint">Round chimes, win fanfare, penalty womp.</p>
          </div>
          <button
            className={`toggle-switch ${soundEnabled ? 'on' : ''}`}
            role="switch"
            aria-checked={soundEnabled}
            onClick={onToggleSound}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <div className="more-toggle-row">
          <div>
            <strong>Dark mode</strong>
            <p className="more-hint">Easy on the eyes for late-night rounds.</p>
          </div>
          <button
            className={`toggle-switch ${darkMode ? 'on' : ''}`}
            role="switch"
            aria-checked={darkMode}
            onClick={onToggleDark}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>

      <div className="card danger-card">
        <h2>Reset</h2>
        <p className="more-hint">Clears the game in progress. Finished games in history stay safe.</p>
        <button className="link danger-link icon-btn" onClick={onResetGame}><Trash2 size={13} /> Reset current game</button>
      </div>

      <div className="card about-card">
        <h2>About</h2>
        <p className="more-hint">
          <strong>King Score</strong> — score keeper for the King card game.
          Tracks rounds, seasons, achievements and analytics for 3–4 players,
          and pulls championship games in from King Online.
        </p>
        <p className="more-hint" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Handshake size={14} /> Ties are shared: everyone on the top score takes the win.
        </p>
      </div>
    </div>
  )
}
