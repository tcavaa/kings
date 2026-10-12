import { useState } from 'react'
import { Trophy } from 'lucide-react'
import { SEASON_THEMES, DEFAULT_THEME } from '../utils/themes'

/**
 * Season dialog, used in two modes:
 *  - mode="end":  after the PIN check when ending a season. Shows the
 *    computed champion of the closing season, then asks the user to NAME
 *    the new season that starts now and pick its THEME.
 *  - mode="edit": rename / re-theme the current season from the banner.
 */
export default function SeasonEndModal({
  mode = 'end',
  champion = null,
  defaultName = '',
  defaultTheme = DEFAULT_THEME,
  saving = false,
  onCancel,
  onConfirm,
}) {
  const [name, setName] = useState(defaultName || '')
  const [theme, setTheme] = useState(defaultTheme || DEFAULT_THEME)

  const isEnd = mode === 'end'

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onCancel}>
      <div className="modal season-modal" onClick={e => e.stopPropagation()}>
        <h3>{isEnd ? 'Start the New Season' : 'Edit Current Season'}</h3>

        {isEnd && (
          <div className="season-modal-champion">
            <span className="season-modal-champion-label">Season champion{champion?.includes(' & ') ? 's (tie)' : ''}</span>
            <span className="season-modal-champion-name"><Trophy size={16} /> {champion}</span>
          </div>
        )}

        <p className="season-modal-hint">
          {isEnd
            ? 'The old season is closed and archived. Give the new season a name and pick its vibe — the whole app dresses up to match.'
            : 'Rename the current season or switch its theme.'}
        </p>

        <label className="season-modal-label" htmlFor="season-name-input">Season name</label>
        <input
          id="season-name-input"
          type="text"
          maxLength={40}
          value={name}
          placeholder='e.g. "Summer Showdown 2026"'
          onChange={e => setName(e.target.value)}
          className="season-modal-input"
          autoFocus
        />

        <label className="season-modal-label">Theme</label>
        <div className="theme-picker">
          {SEASON_THEMES.map(t => (
            <button
              key={t.id}
              type="button"
              className={`theme-option theme-option-${t.id} ${theme === t.id ? 'selected' : ''}`}
              onClick={() => setTheme(t.id)}
            >
              <span className="theme-option-emoji"><t.Icon size={20} /></span>
              <span className="theme-option-label">{t.label}</span>
              <span className="theme-option-tagline">{t.tagline}</span>
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button className="link" disabled={saving} onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            disabled={saving || !name.trim()}
            onClick={() => onConfirm({ name: name.trim(), theme })}
          >
            {saving ? 'Saving…' : (isEnd ? 'Start Season' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}
