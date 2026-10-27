import { useMemo, useState } from 'react'
import { Globe, Handshake } from 'lucide-react'
import TrophyIcon from './TrophyIcon'
import { isChampionName, seasonChampions } from '../utils/winners'
import { seasonStandings } from '../utils/seasonStandings'
import { formatDate } from '../utils/dates'

const fmt = formatDate

// The season's table, counted the way its champion was crowned (see
// utils/seasonStandings.js): every game recorded here and every King Online
// championship game of the season, ranked by wins.
function SeasonStats({ season, data, loading }) {
  const players = useMemo(
    () => (data ? seasonStandings([...data.live.results, ...data.online.results], season.started_at, season.ended_at) : []),
    [data, season.started_at, season.ended_at]
  )

  if (loading && !data) return (
    <p style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 0' }}>იტვირთება…</p>
  )
  if (!players.length) return (
    <p style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 0' }}>ამ სეზონში თამაში არ ყოფილა.</p>
  )

  return (
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid rgba(0,0,0,0.15)' }}>
            <th style={th}>მოთამაშე</th>
            <th style={{ ...th, textAlign: 'center' }}>ლაივი მოგ.</th>
            <th style={{ ...th, textAlign: 'center' }}><Globe size={10} /> მოგ.</th>
            <th style={{ ...th, textAlign: 'center' }}>სულ მოგ.</th>
            <th style={{ ...th, textAlign: 'center' }}>თამაში</th>
            <th style={{ ...th, textAlign: 'center' }}>მოგ. %</th>
            <th style={{ ...th, textAlign: 'center' }}>საშ.</th>
          </tr>
        </thead>
        <tbody>
          {players.map(p => {
            const winPct    = p.games > 0 ? ((p.wins / p.games) * 100).toFixed(0) + '%' : '—'
            const avg       = p.games > 0 ? (p.totalScore / p.games).toFixed(1) : '—'
            const isChamp   = isChampionName(seasonChampions(season), p.name)
            return (
              <tr key={p.name} style={{ borderBottom: '1px solid var(--line)', background: isChamp ? 'rgba(0,0,0,0.15)' : undefined }}>
                <td style={{ ...td, fontWeight: isChamp ? 700 : 400, color: isChamp ? 'var(--text)' : 'var(--text)' }}>
                  {isChamp && <TrophyIcon size={13} color="var(--text)" style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                  {p.name}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>{p.liveWins}</td>
                <td style={{ ...td, textAlign: 'center' }}>{p.onlineWins}</td>
                <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{p.wins}</td>
                <td style={{ ...td, textAlign: 'center' }}>{p.games}</td>
                <td style={{ ...td, textAlign: 'center' }}>{winPct}</td>
                <td style={{ ...td, textAlign: 'center', color: +avg > 0 ? 'var(--accent-good)' : +avg < 0 ? 'var(--accent-bad)' : 'var(--text)' }}>{avg}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const th = { padding: '6px 8px', textAlign: 'left', fontWeight: 700, color: 'var(--text)', fontSize: 11 }
const td = { padding: '6px 8px', color: 'var(--text)' }

export default function SeasonChampionsTab({ seasons, data, loading }) {
  const [expanded, setExpanded] = useState(null)

  return (
    <div>
      {/* Trophy header */}
      <div className="season-trophy-header">
        <div style={{
          background: 'rgba(0,0,0,0.35)',
          borderRadius: '50%',
          padding: 14,
          border: '2px solid var(--line)',
          lineHeight: 0,
        }}>
          <TrophyIcon size={64} color="var(--text)" />
        </div>
        <div className="engraved-title">სეზონის ჩემპიონები</div>
        {seasons[0] && (
          <div className="engraved-subtitle">
            მოქმედი ჩემპიონი: <strong>{seasons[0].champion_name}</strong>
          </div>
        )}
      </div>

      {/* Season list */}
      {seasons.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 16 }}>სეზონები ჯერ არ გამოცხადებულა.</p>
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
                    <TrophyIcon size={22} color="var(--text)" />
                    <div>
                      <div className="engraved-season-name">
                        {s.name || `სეზონი ${seasonNum}`}
                      </div>
                      <div className="engraved-period">{fmt(s.started_at)} — {fmt(s.ended_at)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="engraved-champion">{s.champion_name}</div>
                    <div className="engraved-label">
                      {seasonChampions(s).length > 1
                        ? <>თანაჩემპიონები <Handshake size={10} style={{ verticalAlign: '-1px' }} /></>
                        : 'ჩემპიონი'}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="season-card-body">
                    <SeasonStats season={s} data={data} loading={loading} />
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
