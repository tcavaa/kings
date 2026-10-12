import { useMemo, useState } from 'react'
import { Globe, Handshake } from 'lucide-react'
import TrophyIcon from './TrophyIcon'
import { computeGlobalStats } from '../utils/analytics'
import { isOnlineWinner, isChampionName } from '../utils/winners'
import { getTheme } from '../utils/themes'

const fmt = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function SeasonStats({ season, allDetails, allResults, allOnlineGames, supabasePlayers }) {
  const start = new Date(season.started_at)
  const end   = new Date(season.ended_at)

  const details = useMemo(
    () => allDetails.filter(d => { const t = new Date(d.played_at); return t >= start && t <= end }),
    [allDetails, season.id]
  )
  const results = useMemo(
    () => allResults.filter(r => { const t = new Date(r.played_at); return t >= start && t <= end }),
    [allResults, season.id]
  )

  // Online stats for this season
  const onlineStatsMap = useMemo(() => {
    const m = {}
    allOnlineGames
      .filter(g => { const t = new Date(g.playedAt); return t >= start && t <= end })
      .forEach(g => {
        ;(g.players || []).forEach(p => {
          if (!m[p.name]) m[p.name] = { gamesPlayed: 0, wins: 0 }
          m[p.name].gamesPlayed++
          if (isOnlineWinner(g, p.name)) m[p.name].wins++
        })
      })
    return m
  }, [allOnlineGames, season.id])

  const uuidToOnlineName = useMemo(() => {
    const m = {}
    supabasePlayers.forEach(p => { if (p.online_name) m[p.id] = p.online_name })
    return m
  }, [supabasePlayers])

  const playerMap = useMemo(() => computeGlobalStats(details, results), [details, results])
  const players = useMemo(
    () => Object.entries(playerMap)
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => {
        const aW = a.wins + (onlineStatsMap[uuidToOnlineName[a.id]]?.wins ?? 0)
        const bW = b.wins + (onlineStatsMap[uuidToOnlineName[b.id]]?.wins ?? 0)
        return bW - aW
      }),
    [playerMap, onlineStatsMap, uuidToOnlineName]
  )

  if (!players.length) return (
    <p style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 0' }}>No local game data for this season.</p>
  )

  return (
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid rgba(0,0,0,0.15)' }}>
            <th style={th}>Player</th>
            <th style={{ ...th, textAlign: 'center' }}>Local W</th>
            <th style={{ ...th, textAlign: 'center' }}><Globe size={10} /> W</th>
            <th style={{ ...th, textAlign: 'center' }}>All W</th>
            <th style={{ ...th, textAlign: 'center' }}>Games</th>
            <th style={{ ...th, textAlign: 'center' }}>Win%</th>
            <th style={{ ...th, textAlign: 'center' }}>Avg</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => {
            const online = onlineStatsMap[uuidToOnlineName[p.id]]
            const allWins   = p.wins + (online?.wins ?? 0)
            const allGames  = p.gamesPlayed + (online?.gamesPlayed ?? 0)
            const winPct    = allGames > 0 ? ((allWins / allGames) * 100).toFixed(0) + '%' : '—'
            const avg       = p.gamesPlayed > 0 ? (p.totalScore / p.gamesPlayed).toFixed(1) : '—'
            const isChamp   = isChampionName(season.champion_name, p.name)
            return (
              <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,200,60,0.15)', background: isChamp ? 'rgba(0,0,0,0.15)' : undefined }}>
                <td style={{ ...td, fontWeight: isChamp ? 700 : 400, color: isChamp ? '#ffe566' : 'rgba(255,235,160,0.9)' }}>
                  {isChamp && <TrophyIcon size={13} color="#ffe566" style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                  {p.name}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>{p.wins}</td>
                <td style={{ ...td, textAlign: 'center' }}>{online ? online.wins : '—'}</td>
                <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{allWins}</td>
                <td style={{ ...td, textAlign: 'center' }}>{allGames}</td>
                <td style={{ ...td, textAlign: 'center' }}>{winPct}</td>
                <td style={{ ...td, textAlign: 'center', color: +avg > 0 ? '#86efac' : +avg < 0 ? '#fca5a5' : 'rgba(255,235,160,0.9)' }}>{avg}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const th = { padding: '6px 8px', textAlign: 'left', fontWeight: 700, color: 'rgba(255,240,170,0.85)', fontSize: 11 }
const td = { padding: '6px 8px', color: 'rgba(255,235,160,0.9)' }

export default function SeasonChampionsTab({ seasons, allDetails, allResults, allOnlineGames, supabasePlayers }) {
  const [expanded, setExpanded] = useState(null)

  return (
    <div>
      {/* Trophy header */}
      <div className="season-trophy-header">
        <div style={{
          background: 'rgba(0,0,0,0.35)',
          borderRadius: '50%',
          padding: 14,
          border: '2px solid rgba(255,210,60,0.35)',
          lineHeight: 0,
        }}>
          <TrophyIcon size={64} color="#ffe566" />
        </div>
        <div className="engraved-title">Season Champions</div>
        {seasons[0] && (
          <div className="engraved-subtitle">
            Current champion: <strong>{seasons[0].champion_name}</strong>
          </div>
        )}
      </div>

      {/* Season list */}
      {seasons.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 16 }}>No seasons have been declared yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {seasons.map((s, i) => {
            const isOpen = expanded === s.id
            const seasonNum = seasons.length - i
            return (
              <div key={s.id} className="season-card">
                <button
                  className="season-card-header"
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TrophyIcon size={22} color="#b5860a" />
                    <div>
                      <div className="engraved-season-name">
                        {s.name
                          ? (() => {
                              const ThemeIcon = getTheme(s.theme).Icon
                              return <><ThemeIcon size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{s.name}</>
                            })()
                          : `Season ${seasonNum}`}
                      </div>
                      <div className="engraved-period">{fmt(s.started_at)} — {fmt(s.ended_at)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="engraved-champion">{s.champion_name}</div>
                    <div className="engraved-label">
                      {(s.champion_name || '').includes(' & ')
                        ? <>Co-Champions <Handshake size={10} style={{ verticalAlign: '-1px' }} /></>
                        : 'Champion'}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="season-card-body">
                    <SeasonStats
                      season={s}
                      allDetails={allDetails}
                      allResults={allResults}
                      allOnlineGames={allOnlineGames}
                      supabasePlayers={supabasePlayers}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
