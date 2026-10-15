import { useMemo } from 'react'
import { Globe, Trophy, Crown, Handshake, Timer } from 'lucide-react'
import { formatDuration } from '../../../shared/duration.js'
import { useGameData } from '../lib/gameData'
import { usePaged } from '../hooks/usePaged'
import GameDetailPage from './GameDetailPage'
import OnlineHistoryTab from './OnlineHistoryTab'
import SeasonChampionsTab from './SeasonChampionsTab'
import ShowMore from './ShowMore'
import { computePerGameAchievements, ACHIEVEMENT_DEFS } from '../utils/achievements'
import { winnerNamesOf, isWinnerOf, isTieResult } from '../utils/winners'
import { goBack, navigate, pathOf, useLocation } from '../../../shared/router'
import { formatDate } from '../utils/dates'

const NONE = []

// { [playerName]: uniqueAchievementCodes[] } for one game's detail row.
function achievementsByName(detail) {
  if (!detail?.players || !detail.rounds) return {}
  const achs = computePerGameAchievements(detail.players, detail.rounds)
  const byName = {}
  detail.players.forEach(p => {
    const codes = [...new Set(achs[p.id] || [])]
    if (codes.length) byName[p.name] = codes
  })
  return byName
}

export default function WinnersPage({ seasons }) {
  const { data, loading } = useGameData()
  const results = data?.live.results ?? NONE
  const details = data?.live.details ?? NONE

  // /score/history (local games), /score/history/online, /score/history/seasons;
  // a local game opens at /score/history/game/<id>.
  const { segments } = useLocation('/score')
  const [, tab, gameId] = segments
  const historyTab = tab === 'online' || tab === 'seasons' ? tab : 'local'
  const subView = tab === 'game' && gameId ? 'detail' : 'list'
  const selectedResultId = subView === 'detail' ? gameId : null
  const setHistoryTab = key => navigate(key === 'local' ? '/score/history' : `/score/history/${key}`, { scroll: false })
  const backToList = () => goBack('/score/history')

  const detailById = useMemo(() => new Map(details.map(d => [d.game_result_id, d])), [details])
  const { visible, remaining, showMore } = usePaged(results)

  // Achievements of the games on screen only (each one replays the game).
  const gameAchievementsMap = useMemo(() => {
    const map = {}
    visible.forEach(r => { map[r.id] = achievementsByName(detailById.get(r.id)) })
    return map
  }, [visible, detailById])

  if (subView === 'detail' && loading && !data) {
    return <div className="card"><p style={{ color: 'var(--muted)', margin: 0 }}>იტვირთება…</p></div>
  }

  if (subView === 'detail') {
    const result = results.find(r => r.id === selectedResultId)
    const detail = detailById.get(selectedResultId)
    if (!detail) {
      return (
        <div className="card">
          <h2>თამაშის დეტალები</h2>
          <p style={{ color: 'var(--muted)' }}>ამ თამაშის დეტალები არ არის.</p>
          <div className="actions">
            <button className="primary" onClick={backToList}>უკან</button>
          </div>
        </div>
      )
    }
    return <GameDetailPage detail={detail} result={result} onBack={backToList} />
  }

  return (
    <div className="card">
      <div className="history-header">
        <h2 style={{ margin: 0 }}>თამაშების ისტორია</h2>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'local',   label: 'ლაივი',      Icon: null },
          { key: 'online',  label: 'ონლაინ',     Icon: Globe },
          { key: 'seasons', label: 'სეზონები',   Icon: Trophy },
        ].map(t => (
          <button
            key={t.key}
            className={`${historyTab === t.key ? 'primary' : 'link'} icon-btn`}
            style={{ fontSize: 13, padding: '6px 14px' }}
            onClick={() => setHistoryTab(t.key)}
          >
            {t.Icon && <t.Icon size={13} />}{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {historyTab === 'local' && (
        loading ? (
          <p style={{ color: 'var(--muted)' }}>იტვირთება…</p>
        ) : results.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>ჯერ არცერთი თამაში არ ჩაწერილა.</p>
        ) : (
          <>
          <div className="history-list">
            {visible.map(r => {
              const hasDetail = detailById.has(r.id)
              const playerAchs = gameAchievementsMap[r.id] || {}
              const sorted = [...(r.participants || [])].sort((a, b) => b.score - a.score)
              return (
                <div key={r.id} className="history-card">
                  <div className="history-card-top">
                    <span className="history-date">
                      {formatDate(r.played_at)}
                      {r.duration_seconds != null && (
                        <span className="history-duration">
                          <Timer size={11} /> {formatDuration(r.duration_seconds)}
                        </span>
                      )}
                    </span>
                    {hasDetail ? (
                      <button className="link history-details-btn" onClick={() => navigate(pathOf('/score/history', 'game', r.id))}>
                        დეტალები →
                      </button>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>დეტალები არ არის</span>
                    )}
                  </div>
                  <div className="history-winner">
                    {isTieResult(r)
                      ? <Handshake size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                      : <Crown size={15} style={{ verticalAlign: '-2px', marginRight: 5, color: 'var(--accent-gold)' }} />}
                    {winnerNamesOf(r).join(' & ') || r.winner_name}
                    {isTieResult(r) && <span className="history-tie-tag">ფრე — გაყოფილი მოგება</span>}
                  </div>
                  <div className="history-participants">
                    {sorted.map((p, i) => {
                      const codes = playerAchs[p.name] || []
                      return (
                        <div key={i} className={`history-participant ${isWinnerOf(r, p.name) ? 'is-winner' : ''}`}>
                          <span className="history-participant-name">{p.name}</span>
                          {codes.length > 0 && (
                            <span className="history-participant-awards">
                              {codes.map((code, j) => {
                                const def = ACHIEVEMENT_DEFS[code]
                                return def ? (
                                  <span key={j} className="history-award-badge" title={`${def.label}: ${def.desc}`}>
                                    <def.Icon size={13} color={def.color} />
                                  </span>
                                ) : null
                              })}
                            </span>
                          )}
                          <span className={`history-participant-score ${p.score >= 0 ? 'pos' : 'neg'}`}>
                            {p.score > 0 ? `+${p.score}` : p.score}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <ShowMore remaining={remaining} onClick={showMore} />
          </>
        )
      )}

      {historyTab === 'online' && <OnlineHistoryTab />}

      {historyTab === 'seasons' && (
        <SeasonChampionsTab seasons={seasons} data={data} loading={loading} />
      )}

    </div>
  )
}
