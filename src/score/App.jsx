import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { computeScoresForRound } from './utils/scoring'
import PlayerInput from './components/PlayerInput.jsx'
import GameTypeSelector from './components/GameTypeSelector.jsx'
import { GAME_TYPES } from './constants/gameTypes'
import ScoreTable from './components/ScoreTable.jsx'
import GameTypeMatrix from './components/GameTypeMatrix.jsx'
import PlayersPage from './components/PlayersPage.jsx'
import WinnersPage from './components/WinnersPage.jsx'
import ScoreChart from './components/ScoreChart.jsx'
import GameAnalytics from './components/GameAnalytics.jsx'
import WinProbability from './components/WinProbability.jsx'
import GameProgress from './components/GameProgress.jsx'
import StatsPage from './components/StatsPage.jsx'
import MorePage from './components/MorePage.jsx'
import BottomNav from './components/BottomNav.jsx'
import SeasonBanner from './components/SeasonBanner.jsx'
import SeasonEndModal from './components/SeasonEndModal.jsx'
import GameTimer from './components/GameTimer.jsx'
import ThemeDecorations from './components/ThemeDecorations.jsx'
import { supabase } from './lib/supabase.js'
import { useSeasons } from './hooks/useSeasons'
import { joinWinnerNames } from './utils/winners'
import { applyThemeToBody } from './utils/themes'
import { formatDuration } from './utils/time'
import { RefreshCw, Trash2, Timer } from 'lucide-react'
import confetti from 'canvas-confetti'
import { playRoundEnd, playBigPenalty, playGameWin, playRematch } from './utils/sounds.js'
import './styles/main.css'

export const PLAYER_COLORS = ['#2563eb', '#059669', '#dc2626', '#d97706']

function App() {
  const [state, dispatch] = useReducer(
    (s, action) => {
      switch (action.type) {
        case 'HYDRATE': {
          const merged = { ...s, ...action.payload }
          // Snapshots saved before the game clock existed have no
          // startedAt — start counting from the moment they're restored.
          if (merged.players && !merged.startedAt) merged.startedAt = Date.now()
          return merged
        }
        case 'START':
          return { players: action.players, activePlayerIndex: 0, rounds: [], startedAt: Date.now(), endedAt: null }
        case 'END_ROUND': {
          const rounds = [...s.rounds, action.round]
          const nextLeader = s.players ? (s.activePlayerIndex + 1) % s.players.length : 0
          // Freeze the game clock the moment the final round is entered.
          const target = s.players ? s.players.length * GAME_TYPES.length : Infinity
          const endedAt = !s.endedAt && rounds.length >= target ? Date.now() : s.endedAt
          return { ...s, rounds, activePlayerIndex: nextLeader, endedAt }
        }
        case 'EDIT_LAST': {
          if (!s.rounds.length) return s
          const next = [...s.rounds]
          next[next.length - 1] = action.round
          return { ...s, rounds: next }
        }
        case 'UNDO_LAST': {
          if (!s.rounds.length) return s
          const prevLeader = s.players
            ? (s.activePlayerIndex - 1 + s.players.length) % s.players.length
            : 0
          // Undoing the final round un-finishes the game — resume the clock.
          return { ...s, rounds: s.rounds.slice(0, -1), activePlayerIndex: prevLeader, endedAt: null }
        }
        case 'RESET':
          return { players: null, activePlayerIndex: 0, rounds: [], startedAt: null, endedAt: null }
        default:
          return s
      }
    },
    { players: null, activePlayerIndex: 0, rounds: [], startedAt: null, endedAt: null }
  )
  const { players, activePlayerIndex, rounds, startedAt, endedAt } = state
  const [hydrated, setHydrated] = useState(false)
  const [preselectedTypeCode, setPreselectedTypeCode] = useState(null)
  // 'home' (Score) | 'history' | 'stats' | 'more' | 'players'
  const [view, setView] = useState('home')
  const [saving, setSaving] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('king-sound') !== 'off')
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('king-theme') === 'dark')
  const [editingSeason, setEditingSeason] = useState(false)
  const {
    seasons, currentChampion, currentSeasonStart,
    currentSeasonName, currentSeasonTheme,
    endSeason, updateCurrentSeason,
  } = useSeasons()
  const lastPlayersRef = useRef(null)

  // Apply dark mode class to body
  useEffect(() => {
    document.body.classList.toggle('dark', darkMode)
    localStorage.setItem('king-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // Apply the current season's theme (Summer / Mountain / Christmas / Casual)
  useEffect(() => {
    applyThemeToBody(currentSeasonTheme)
  }, [currentSeasonTheme])

  // Persist sound preference
  useEffect(() => {
    localStorage.setItem('king-sound', soundEnabled ? 'on' : 'off')
  }, [soundEnabled])

  // Load from localStorage on first mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('king-score-state')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && Array.isArray(parsed.rounds) && (parsed.players === null || Array.isArray(parsed.players))) {
          const hasLegacyIds = Array.isArray(parsed.players) && parsed.players.some((p) => /^p\d+$/.test(p.id))
          if (!hasLegacyIds) {
            dispatch({ type: 'HYDRATE', payload: {
              players: parsed.players,
              activePlayerIndex: parsed.activePlayerIndex || 0,
              rounds: parsed.rounds,
              startedAt: parsed.startedAt || null,
              endedAt: parsed.endedAt || null,
            } })
          } else {
            localStorage.removeItem('king-score-state')
          }
        }
      }
    } catch (e) {}
    setHydrated(true)
  }, [])

  // Persist to localStorage on change
  useEffect(() => {
    if (!hydrated) return
    const snapshot = { players, activePlayerIndex, rounds, startedAt, endedAt }
    try {
      localStorage.setItem('king-score-state', JSON.stringify(snapshot))
    } catch (e) {}
  }, [players, activePlayerIndex, rounds, startedAt, endedAt, hydrated])

  const usedTypesByPlayer = useMemo(() => {
    const map = {}
    if (!players) return map
    players.forEach((p) => (map[p.id] = new Set()))
    rounds.forEach((r) => {
      const leaderId = r.leaderPlayerId
      if (!map[leaderId]) map[leaderId] = new Set()
      map[leaderId].add(r.gameTypeCode)
    })
    return map
  }, [players, rounds])

  const targetRoundsCount = useMemo(() => {
    if (!players) return 0
    return players.length * GAME_TYPES.length
  }, [players])

  const gameFinished = !!(players && rounds.length >= targetRoundsCount && targetRoundsCount > 0)

  const finishedParticipants = useMemo(() => {
    if (!gameFinished || !players) return []
    const totals = {}
    players.forEach(p => { totals[p.id] = 0 })
    rounds.forEach(r => {
      if (r.scores) players.forEach(p => { totals[p.id] += r.scores[p.id] || 0 })
    })
    return players.map(p => ({ name: p.name, score: totals[p.id] }))
  }, [gameFinished, players, rounds])

  useEffect(() => {
    if (!gameFinished) return
    confetti({ particleCount: 180, spread: 90, origin: { y: 0.6 } })
    if (soundEnabled) playGameWin()
  }, [gameFinished])

  // Final game duration in seconds (null until the clock has both ends).
  const durationSeconds = startedAt && endedAt
    ? Math.max(0, Math.round((endedAt - startedAt) / 1000))
    : null

  const saveGameToDB = useCallback(async (playersList, roundsList, gameDuration = null) => {
    const totals = {}
    playersList.forEach((p) => (totals[p.id] = 0))
    roundsList.forEach((r) => {
      if (r.scores) playersList.forEach((p) => {
        totals[p.id] = (totals[p.id] || 0) + (r.scores[p.id] || 0)
      })
    })
    // Tie-aware: everyone on the top score is a winner. Ties are stored as
    // a joined winner_name ("A & B") — utils/winners.js splits it back out
    // everywhere wins are counted.
    const maxTotal = Math.max(...playersList.map((p) => totals[p.id]))
    const winners = playersList.filter((p) => totals[p.id] === maxTotal)
    const winnerName = joinWinnerNames(winners.map((w) => w.name))
    const participants = playersList.map((p) => ({ name: p.name, score: totals[p.id] }))

    const row = { winner_name: winnerName, participants }
    if (gameDuration != null) row.duration_seconds = gameDuration

    let { data: resultData, error } = await supabase
      .from('game_results')
      .insert(row)
      .select('id')
      .single()

    // duration_seconds needs the supabase migration — if the column isn't
    // there yet, save the game without it rather than losing the result.
    if (error && gameDuration != null) {
      const retry = await supabase
        .from('game_results')
        .insert({ winner_name: winnerName, participants })
        .select('id')
        .single()
      resultData = retry.data
    }

    if (resultData?.id) {
      await supabase.from('game_details').insert({
        game_result_id: resultData.id,
        players: playersList,
        rounds: roundsList,
      })
    }
  }, [])

  const handleComplete = useCallback(async () => {
    if (!players) return
    setSaving(true)
    lastPlayersRef.current = players
    await saveGameToDB(players, rounds, durationSeconds)
    setSaving(false)
    localStorage.removeItem('king-score-state')
    dispatch({ type: 'RESET' })
  }, [players, rounds, saveGameToDB, durationSeconds])

  const handleRematch = useCallback(async () => {
    if (!players) return
    setSaving(true)
    const rematchers = [...players]
    await saveGameToDB(players, rounds, durationSeconds)
    setSaving(false)
    localStorage.removeItem('king-score-state')
    if (soundEnabled) playRematch()
    dispatch({ type: 'START', players: rematchers })
  }, [players, rounds, saveGameToDB, soundEnabled, durationSeconds])

  const handleStart = useCallback((playersList) => {
    dispatch({ type: 'START', players: playersList })
  }, [])

  const onRoundComplete = useCallback((roundRecord) => {
    dispatch({ type: 'END_ROUND', round: roundRecord })
    setPreselectedTypeCode(null)
    if (soundEnabled) {
      const minScore = Math.min(...Object.values(roundRecord.scores || {}))
      if (minScore <= -40) {
        playBigPenalty()
      } else {
        playRoundEnd()
      }
    }
  }, [soundEnabled])

  const onUndoLastRound = useCallback(() => {
    if (!players || rounds.length === 0) return
    dispatch({ type: 'UNDO_LAST' })
  }, [players, rounds])

  const onEditLastRound = useCallback((patch) => {
    if (!players || rounds.length === 0) return
    const lastIdx = rounds.length - 1
    const current = rounds[lastIdx]
    let nextRound = { ...current }
    if (patch.countsByPlayerId) nextRound.countsByPlayerId = { ...patch.countsByPlayerId }
    if (patch.singleTargetPlayerId != null) nextRound.singleTargetPlayerId = patch.singleTargetPlayerId
    const type = GAME_TYPES.find((t) => t.code === nextRound.gameTypeCode)
    nextRound.scores = computeScoresForRound(type, players, nextRound.countsByPlayerId, nextRound.singleTargetPlayerId)
    dispatch({ type: 'EDIT_LAST', round: nextRound })
  }, [players, rounds])

  const handleReset = useCallback(() => {
    const ok = window.confirm('Are you sure you want to reset the current game? This will clear all progress.')
    if (!ok) return
    localStorage.removeItem('king-score-state')
    dispatch({ type: 'RESET' })
    setView('home')
  }, [])

  async function handleSeasonEdit({ name, theme }) {
    await updateCurrentSeason({ name, theme })
    setEditingSeason(false)
  }

  return (
    <div className="app">
      <ThemeDecorations themeId={currentSeasonTheme} />
      <header className="app-header">
        <button className="brand" onClick={() => setView('home')} title="Home">
          <img className="logo" src="/12427687.png" alt="" />
          <h1>KING</h1>
        </button>
      </header>

      <SeasonBanner
        seasonName={currentSeasonName}
        themeId={currentSeasonTheme}
        champion={currentChampion}
      />

      <GameTimer startedAt={startedAt} endedAt={endedAt} />

      <main className="app-content">
        {view === 'players' && (
          <PlayersPage onBack={() => setView('more')} currentChampion={currentChampion} />
        )}

        {view === 'history' && (
          <WinnersPage
            seasons={seasons}
            currentSeasonStart={currentSeasonStart}
            endSeason={endSeason}
          />
        )}

        {view === 'stats' && (
          <StatsPage
            currentSeasonStart={currentSeasonStart}
            onBack={() => setView('home')}
          />
        )}

        {view === 'more' && (
          <MorePage
            onOpenPlayers={() => setView('players')}
            soundEnabled={soundEnabled}
            onToggleSound={() => setSoundEnabled(v => !v)}
            darkMode={darkMode}
            onToggleDark={() => setDarkMode(v => !v)}
            seasonName={currentSeasonName}
            seasonTheme={currentSeasonTheme}
            onEditSeason={() => setEditingSeason(true)}
            onResetGame={handleReset}
          />
        )}

        {view === 'home' && !players && (
          <PlayerInput onStart={handleStart} />
        )}

        {view === 'home' && players && !gameFinished && (
          <>
            <div className="game-toolbar">
              <button type="button" className="link danger-link reset-game-btn" onClick={handleReset}>
                <Trash2 size={13} /> Reset game
              </button>
            </div>
            <GameTypeMatrix
              players={players}
              usedTypesByPlayer={usedTypesByPlayer}
              activePlayerIndex={activePlayerIndex}
              onPreselect={(code) => setPreselectedTypeCode(code)}
              playerColors={PLAYER_COLORS}
              currentChampion={currentChampion}
            />
            <GameTypeSelector
              players={players}
              activePlayerIndex={activePlayerIndex}
              usedTypesByPlayer={usedTypesByPlayer}
              preselectedCode={preselectedTypeCode}
              onRoundComplete={onRoundComplete}
            />
            <ScoreTable
              players={players}
              rounds={rounds}
              onEditLastRound={onEditLastRound}
              onUndoLastRound={onUndoLastRound}
              playerColors={PLAYER_COLORS}
              currentChampion={currentChampion}
            />
            <WinProbability players={players} rounds={rounds} playerColors={PLAYER_COLORS} />
            <GameProgress playedRounds={rounds.length} totalRounds={targetRoundsCount} />
            <div className="meta">
              <div>Round {rounds.length + 1} / {targetRoundsCount}</div>
              <div>Leader: {players[activePlayerIndex].name}</div>
            </div>
          </>
        )}

        {view === 'home' && players && gameFinished && (
          <>
            <ScoreTable players={players} rounds={rounds} gameFinished playerColors={PLAYER_COLORS} currentChampion={currentChampion} />
            {durationSeconds != null && (
              <div className="game-duration-note">
                <Timer size={14} /> Game time: <strong>{formatDuration(durationSeconds)}</strong>
              </div>
            )}
            <div className="actions center">
              <button className="primary" disabled={saving} onClick={handleComplete}>
                {saving ? 'Saving...' : 'Complete'}
              </button>
              <button className="primary success" disabled={saving} onClick={handleRematch}>
                {saving ? '...' : <><RefreshCw size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Rematch</>}
              </button>
              <button className="link" disabled={saving} onClick={handleComplete}>
                New Game
              </button>
            </div>
            <ScoreChart players={players} rounds={rounds} />
            <GameAnalytics players={players} rounds={rounds} participants={finishedParticipants} />
          </>
        )}
      </main>

      <BottomNav view={view} onNavigate={setView} />

      {editingSeason && (
        <SeasonEndModal
          mode="edit"
          defaultName={currentSeasonName || ''}
          defaultTheme={currentSeasonTheme}
          onCancel={() => setEditingSeason(false)}
          onConfirm={handleSeasonEdit}
        />
      )}
    </div>
  )
}

export default App
