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
        <h2>მოთამაშეები</h2>
        <p className="more-hint">ყველას თამაშები, მოგებები და ბეჯები. მოთამაშეებს ადმინი ამატებს და შლის.</p>
        <button className="primary icon-btn" onClick={onOpenPlayers}><Users size={15} /> მოთამაშეები</button>
      </div>

      <div className="card">
        <h2>King Online</h2>
        <p className="more-hint">ითამაშე ონლაინ და ნახე ონლაინ ლიდერბორდი.</p>
        {/* King Online is the site's home page (its own root layout) */}
        <button className="primary icon-btn" onClick={() => window.location.assign('/')}><Spade size={15} /> King Online-ის გახსნა</button>
      </div>

      <div className="card">
        <h2>მიმდინარე სეზონი</h2>
        <div className="more-season-row">
          <span className="more-season-chip">
            <ThemeIcon size={15} /> {seasonName || 'უსახელო სეზონი'}
          </span>
        </div>
        <p className="more-hint">სეზონის სახელს, თემას და დასრულებას ადმინი ადგენს.</p>
      </div>

      <div className="card">
        <h2>პარამეტრები</h2>
        <div className="more-toggle-row">
          <div>
            <strong>ხმები</strong>
            <p className="more-hint">რაუნდის ზარი, მოგების ფანფარა, ჯარიმის ხმა.</p>
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
            <strong>მუქი რეჟიმი</strong>
            <p className="more-hint">თვალს არ ღლის გვიან ღამით.</p>
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
        <h2>გაუქმება</h2>
        <p className="more-hint">შლის მიმდინარე თამაშს. ისტორიაში დასრულებული თამაშები უსაფრთხოდ რჩება.</p>
        <button className="link danger-link icon-btn" onClick={onResetGame}><Trash2 size={13} /> მიმდინარე თამაშის გაუქმება</button>
      </div>

      <div className="card about-card">
        <h2>აპის შესახებ</h2>
        <p className="more-hint">
          <strong>King Score</strong> (ჩაწერა) — ქულების ჩამწერი კინგის თამაშისთვის.
          აღრიცხავს რაუნდებს, სეზონებს, მიღწევებს და სტატისტიკას 3–4 მოთამაშისთვის,
          და King Online-იდან ჩემპიონატის თამაშებსაც იღებს.
        </p>
        <p className="more-hint" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Handshake size={14} /> ფრე იყოფა: ყველა, ვისაც უმაღლესი ქულა აქვს, მოგებას იღებს.
        </p>
      </div>
    </div>
  )
}
