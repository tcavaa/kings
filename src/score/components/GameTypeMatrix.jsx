import { GAME_TYPES } from '../constants/gameTypes'
import TrophyIcon from './TrophyIcon'
import { isChampionName } from '../utils/winners'
import { MATRIX_CELL_DECOR } from '../utils/decorations'

export default function GameTypeMatrix({ players, usedTypesByPlayer, activePlayerIndex, onPreselect, playerColors = [], currentChampion }) {
  return (
    <div className="card matrix">
      <h2>Game Types Availability</h2>
      <div className="matrix-grid">
        <div className="matrix-header sticky">
          <div className="cell type-col">Type</div>
          {players.map((p, idx) => (
            <div
              key={p.id}
              className={`cell player-col ${idx === activePlayerIndex ? 'active' : ''}`}
              style={{ borderBottom: playerColors[idx] ? `3px solid ${playerColors[idx]}` : undefined }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {p.name}
                {isChampionName(currentChampion, p.name) && <TrophyIcon size={16} color="#d4a017" />}
              </span>
            </div>
          ))}
        </div>
        {GAME_TYPES.map((t) => (
          <div key={t.code} className="matrix-row">
            <div className="cell type-col code">{t.code}</div>
            {players.map((p, idx) => {
              const used = (usedTypesByPlayer[p.id] || new Set()).has(t.code)
              return (
                <button
                  key={p.id}
                  className={`cell player-col ${used ? 'used' : 'available'}`}
                  type="button"
                  disabled={used || idx !== activePlayerIndex}
                  onClick={() => onPreselect && onPreselect(t.code)}
                  data-decor={MATRIX_CELL_DECOR[`${t.code}-${idx}`]}
                >
                  {used ? '✕' : '•'}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="legend">
        <span className="dot available">•</span> Available
        <span className="dot used">✕</span> Used
      </div>
    </div>
  )
}


