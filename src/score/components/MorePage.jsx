import { Users, Trash2, Handshake, Spade } from 'lucide-react'
import { getTheme } from '../utils/themes'

/**
 * The "More" tab: players, preferences, the current season and a small
 * about card. Players and seasons are managed in King Online's /admin.
 */
export default function MorePage({
  onOpenPlayers,
  soundEnabled,
  onToggleSound,
  darkMode,
  onToggleDark,
  seasonName,
  seasonTheme,
  onResetGame,
}) {
  const ThemeIcon = getTheme(seasonTheme).Icon

  return (
    <div className="more-page">
      <div className="card">
        <h2>Players</h2>
        <p className="more-hint">Everyone's games, wins and badges. Players are added and removed by the admin.</p>
        <button className="primary icon-btn" onClick={onOpenPlayers}><Users size={15} /> Players</button>
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
        </div>
        <p className="more-hint">The season's name, theme and end are set by the admin.</p>
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
