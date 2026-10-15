import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Radio, ArrowLeft, Crown } from 'lucide-react'
import { useLiveSheets } from '../lib/gameData'
import { GAME_TYPES } from '../constants/gameTypes'
import { PLAYER_COLORS } from '../constants/colors'
import { totalsByPlayer } from '../utils/rounds'
import { setQuery } from '../../../shared/router'
import ScoreTable from './ScoreTable'
import GameProgress from './GameProgress'

// The chart library loads only when someone opens a live game.
const ScoreChart = lazy(() => import('./ScoreChart'))

function ago(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000))
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`
}

function SheetView({ sheet, onBack }) {
  const target = sheet.players.length * GAME_TYPES.length
  const finished = sheet.rounds.length >= target || !!sheet.surrenderedBy
  const surrendered = sheet.surrenderedBy ? sheet.players.find(p => p.id === sheet.surrenderedBy)?.name ?? 'A player' : null
  return (
    <>
      <div className="card">
        <div className="history-header">
          <h2 style={{ margin: 0 }} className="icon-btn"><Radio size={16} color="#dc2626" /> Live game</h2>
          <button className="link icon-btn" onClick={onBack}><ArrowLeft size={13} /> Back</button>
        </div>
        <p className="more-hint" style={{ margin: 0 }}>
          {surrendered ? `${surrendered} surrendered — waiting to be saved`
            : finished ? 'All rounds played — waiting to be saved' : `Round ${sheet.rounds.length + 1} / ${target} · leader ${sheet.players[sheet.activePlayerIndex]?.name ?? '—'}`}
          {' · updated '}{ago(sheet.updatedAt)}
        </p>
      </div>
      <ScoreTable players={sheet.players} rounds={sheet.rounds} gameFinished={finished} playerColors={PLAYER_COLORS} />
      <GameProgress playedRounds={sheet.rounds.length} totalRounds={target} />
      {sheet.rounds.length > 0 && <Suspense fallback={null}><ScoreChart players={sheet.players} rounds={sheet.rounds} /></Suspense>}
    </>
  )
}

/**
 * Games being scored right now on other phones, refreshed every few seconds.
 * Renders nothing when nobody is playing. `?live=<id>` opens one directly
 * (a link someone shared). `children` (the new-game setup) shows below the
 * list, but not while someone's game is open.
 */
export default function LiveSheets({ children }) {
  const loaded = useLiveSheets()
  const sheets = loaded || []
  const [openId, setOpenId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('live') } catch { return null }
  })
  const open = useMemo(() => sheets.find(s => s.id === openId) || null, [sheets, openId])

  // Keep the address in step so a refresh (or a shared link) shows the same game.
  useEffect(() => { setQuery('live', openId) }, [openId])

  if (openId && open) return <SheetView sheet={open} onBack={() => setOpenId(null)} />
  if (openId && !loaded) return children
  if (openId && !open) {
    // The game was saved (or reset) meanwhile.
    return (
      <div className="card">
        <div className="history-header">
          <h2 style={{ margin: 0 }}>Live game</h2>
          <button className="link icon-btn" onClick={() => setOpenId(null)}><ArrowLeft size={13} /> Back</button>
        </div>
        <p className="more-hint" style={{ margin: 0 }}>This game isn’t live any more — once saved it shows up in History.</p>
      </div>
    )
  }
  if (!sheets.length) return children

  return (
    <>
    <div className="card">
      <h2 className="icon-btn" style={{ justifyContent: 'flex-start' }}><Radio size={16} color="#dc2626" /> Live now</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {sheets.map(sheet => {
          const totals = totalsByPlayer(sheet.players, sheet.rounds)
          const ranked = [...sheet.players].sort((a, b) => totals[b.id] - totals[a.id])
          const target = sheet.players.length * GAME_TYPES.length
          return (
            <button key={sheet.id} className="link" onClick={() => setOpenId(sheet.id)}
              style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, display: 'grid', gap: 4 }}>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', color: 'var(--text)', fontSize: 14 }}>
                {ranked.map((p, i) => (
                  <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: i === 0 ? 700 : 500 }}>
                    {i === 0 && sheet.rounds.length > 0 && <Crown size={12} color="var(--accent-gold)" />}
                    {p.name} <span className={totals[p.id] > 0 ? 'pos' : totals[p.id] < 0 ? 'neg' : ''}>{totals[p.id]}</span>
                  </span>
                ))}
              </span>
              <span className="more-hint" style={{ margin: 0 }}>
                Round {Math.min(sheet.rounds.length + 1, target)} / {target} · updated {ago(sheet.updatedAt)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
    {children}
    </>
  )
}
