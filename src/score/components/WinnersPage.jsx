import { useMemo, useState } from 'react'
import { Flag, Globe, Trophy, Crown, Handshake, Timer } from 'lucide-react'
import { formatDuration } from '../utils/time'
import { useGameResults } from '../hooks/useGameResults'
import { useAllGameDetails } from '../hooks/useAllGameDetails'
import { usePlayers } from '../hooks/usePlayers'
import { useOnlineGames } from '../hooks/useOnlineData'
import GameDetailPage from './GameDetailPage'
import OnlineHistoryTab from './OnlineHistoryTab'
import SeasonChampionsTab from './SeasonChampionsTab'
import PinModal from './PinModal'
import SeasonEndModal from './SeasonEndModal'
import { computePerGameAchievements, ACHIEVEMENT_DEFS } from '../utils/achievements'
import { winnerNamesOf, isWinnerOf, isTieResult, onlineWinnerNames, joinWinnerNames } from '../utils/winners'

// Determine season champion(s) from combined local + online wins since
// seasonStart. Online names are mapped to local names via
// supabasePlayers.online_name. Tie-aware end to end: a tied GAME gives all
// its winners a win, and a tied SEASON crowns co-champions ("A & B").
// Only championship games arrive from the online API, so casual/public
// online games never influence the season.
function determineChampion(localResults, onlineGames, seasonStart, supabasePlayers) {
  const wins = {}
  const addWin = (name) => { if (name) wins[name] = (wins[name] || 0) + 1 }

  localResults
    .filter(r => new Date(r.played_at) > seasonStart)
    .forEach(r => { winnerNamesOf(r).forEach(addWin) })

  onlineGames
    .filter(g => new Date(g.playedAt) > seasonStart)
    .forEach(g => {
      onlineWinnerNames(g).forEach(onlineName => {
        const local = supabasePlayers.find(p => p.online_name === onlineName)
        addWin(local?.name || onlineName)
      })
    })

  const entries = Object.entries(wins)
  if (!entries.length) return null
  const maxWins = Math.max(...entries.map(([, count]) => count))
  const champions = entries
    .filter(([, count]) => count === maxWins)
    .map(([name]) => name)
    .sort()
  return joinWinnerNames(champions)
}

export default function WinnersPage({ seasons, currentSeasonStart, endSeason }) {
  const { results, loading: resultsLoading } = useGameResults()
  const { details, loading: detailsLoading } = useAllGameDetails()
  const { players: supabasePlayers } = usePlayers()
  const { games: onlineGames } = useOnlineGames(500)

  const [subView, setSubView]           = useState('list')      // 'list' | 'detail'
  const [historyTab, setHistoryTab]     = useState('local')     // 'local' | 'online' | 'seasons'
  const [selectedResultId, setSelectedResultId] = useState(null)
  const [showPin, setShowPin]           = useState(false)
  // After the PIN: the computed champion for the closing season, which the
  // SeasonEndModal shows while asking for the new season's name + theme.
  const [pendingChampion, setPendingChampion] = useState(null)
  const [ending, setEnding]             = useState(false)
  const [endMsg, setEndMsg]             = useState(null)        // { ok, text }

  const loading = resultsLoading || detailsLoading

  // { [game_result_id]: { [playerName]: uniqueAchievementCodes[] } }
  const gameAchievementsMap = useMemo(() => {
    const map = {}
    details.forEach(detail => {
      if (!detail.players || !detail.rounds) return
      const achs = computePerGameAchievements(detail.players, detail.rounds)
      const byName = {}
      detail.players.forEach(p => {
        const codes = [...new Set(achs[p.id] || [])]
        if (codes.length) byName[p.name] = codes
      })
      if (Object.keys(byName).length) map[detail.game_result_id] = byName
    })
    return map
  }, [details])

  const seasonStart = currentSeasonStart || new Date(0)

  // PIN passed → compute the champion and hand over to the naming modal.
  function handlePinSuccess() {
    setShowPin(false)
    const champion = determineChampion(results, onlineGames, seasonStart, supabasePlayers)
    if (!champion) {
      setEndMsg({ ok: false, text: 'No games in the current season yet.' })
      return
    }
    setPendingChampion(champion)
  }

  // Modal confirmed → close the old season and open the freshly-named one.
  async function handleEndSeason({ name, theme }) {
    setEnding(true)
    setEndMsg(null)

    // started_at = first actual game in the season (local or online), fallback to seasonStart
    const localTimes  = results.filter(r => new Date(r.played_at) > seasonStart).map(r => new Date(r.played_at))
    const onlineTimes = onlineGames.filter(g => new Date(g.playedAt) > seasonStart).map(g => new Date(g.playedAt))
    const allTimes    = [...localTimes, ...onlineTimes]
    const startedAt   = allTimes.length ? new Date(Math.min(...allTimes)).toISOString() : seasonStart.toISOString()
    const endedAt     = new Date().toISOString()
    const champion    = pendingChampion

    const errorText = await endSeason({
      championName: champion,
      startedAt,
      endedAt,
      nextName: name,
      nextTheme: theme,
    })
    setEnding(false)
    setPendingChampion(null)
    if (errorText) {
      setEndMsg({ ok: false, text: errorText })
    } else {
      setEndMsg({ ok: true, text: `Season ended! Champion: ${champion} — new season “${name}” started.` })
      setHistoryTab('seasons')
    }
  }

  if (subView === 'detail') {
    const result = results.find(r => r.id === selectedResultId)
    const detail = details.find(d => d.game_result_id === selectedResultId)
    if (!detail) {
      return (
        <div className="card">
          <h2>Game Details</h2>
          <p style={{ color: 'var(--muted)' }}>No detailed data for this game.</p>
          <div className="actions">
            <button className="primary" onClick={() => setSubView('list')}>Back</button>
          </div>
        </div>
      )
    }
    return <GameDetailPage detail={detail} result={result} onBack={() => setSubView('list')} />
  }

  return (
    <div className="card">
      <div className="history-header">
        <h2 style={{ margin: 0 }}>Game History</h2>
        <button
          className="link end-season-btn icon-btn"
          onClick={() => { setEndMsg(null); setShowPin(true) }}
          disabled={ending}
        >
          {ending ? 'Ending…' : <><Flag size={13} /> End Season</>}
        </button>
      </div>
      {endMsg && (
        <div className={`season-end-msg ${endMsg.ok ? 'ok' : 'err'}`}>{endMsg.text}</div>
      )}

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'local',   label: 'Local Games', Icon: null },
          { key: 'online',  label: 'Online',      Icon: Globe },
          { key: 'seasons', label: 'Seasons',     Icon: Trophy },
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
          <p style={{ color: 'var(--muted)' }}>Loading...</p>
        ) : results.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No games recorded yet.</p>
        ) : (
          <div className="history-list">
            {results.map(r => {
              const hasDetail = details.some(d => d.game_result_id === r.id)
              const playerAchs = gameAchievementsMap[r.id] || {}
              const sorted = [...(r.participants || [])].sort((a, b) => b.score - a.score)
              return (
                <div key={r.id} className="history-card">
                  <div className="history-card-top">
                    <span className="history-date">
                      {new Date(r.played_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      {r.duration_seconds != null && (
                        <span className="history-duration">
                          <Timer size={11} /> {formatDuration(r.duration_seconds)}
                        </span>
                      )}
                    </span>
                    {hasDetail ? (
                      <button className="link history-details-btn" onClick={() => { setSelectedResultId(r.id); setSubView('detail') }}>
                        Details →
                      </button>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>No details</span>
                    )}
                  </div>
                  <div className="history-winner">
                    {isTieResult(r)
                      ? <Handshake size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                      : <Crown size={15} style={{ verticalAlign: '-2px', marginRight: 5, color: 'var(--accent-gold)' }} />}
                    {winnerNamesOf(r).join(' & ') || r.winner_name}
                    {isTieResult(r) && <span className="history-tie-tag">tie — shared win</span>}
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
        )
      )}

      {historyTab === 'online' && <OnlineHistoryTab />}

      {historyTab === 'seasons' && (
        <SeasonChampionsTab
          seasons={seasons}
          allDetails={details}
          allResults={results}
          allOnlineGames={onlineGames}
          supabasePlayers={supabasePlayers}
        />
      )}

      {showPin && (
        <PinModal
          title="End Season"
          onCancel={() => setShowPin(false)}
          onSuccess={handlePinSuccess}
        />
      )}

      {pendingChampion && (
        <SeasonEndModal
          mode="end"
          champion={pendingChampion}
          saving={ending}
          onCancel={() => setPendingChampion(null)}
          onConfirm={handleEndSeason}
        />
      )}
    </div>
  )
}
