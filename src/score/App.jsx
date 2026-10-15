import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { computeScoresForRound } from './utils/scoring'
import PlayerInput from './components/PlayerInput.jsx'
import GameTypeSelector from './components/GameTypeSelector.jsx'
import { GAME_TYPES } from './constants/gameTypes'
import { PLAYER_COLORS } from './constants/colors'
import ScoreTable from './components/ScoreTable.jsx'
import GameTypeMatrix from './components/GameTypeMatrix.jsx'
import WinProbability from './components/WinProbability.jsx'
import GameProgress from './components/GameProgress.jsx'
import BottomNav from './components/BottomNav.jsx'
import SeasonBanner from './components/SeasonBanner.jsx'
import GameTimer from './components/GameTimer.jsx'
import ThemeDecorations from './components/ThemeDecorations.jsx'
import SurrenderButton from './components/SurrenderButton.jsx'
import { saveGame, publishLiveSheet, removeLiveSheet } from './lib/gameData.js'
import { sheetReducer, EMPTY_SHEET, targetRoundsOf } from './lib/sheetReducer.js'
import LiveSheets from './components/LiveSheets.jsx'
import { useSeasons } from './hooks/useSeasons'
import { applyThemeToBody } from './utils/themes'
import { formatDuration } from '../../shared/duration.js'
import { readStorage, writeStorage } from './utils/storage'
import { totalsByPlayer } from './utils/rounds'
import { RefreshCw, Trash2, Timer, ArrowLeft, Flag } from 'lucide-react'
import { playRoundEnd, playBigPenalty, playGameWin, playRematch } from './utils/sounds.js'
import { goBack, navigate, useLocation } from '../../shared/router'
import './styles/main.css'

// The score sheet itself loads first; the other tabs and the charts (with
// their chart library) load when they are first shown.
const PlayersPage = lazy(() => import('./components/PlayersPage.jsx'))
const WinnersPage = lazy(() => import('./components/WinnersPage.jsx'))
const StatsPage = lazy(() => import('./components/StatsPage.jsx'))
const MorePage = lazy(() => import('./components/MorePage.jsx'))
const ScoreChart = lazy(() => import('./components/ScoreChart.jsx'))
const GameAnalytics = lazy(() => import('./components/GameAnalytics.jsx'))

const PageLoading = (
  <div className="card"><p style={{ color: 'var(--muted)', margin: 0 }}>Loading…</p></div>
)

const STATE_KEY = 'king-score-state'
const VIEWS = ['history', 'stats', 'more', 'players']

// Other people's games in progress are a bonus on the home screen: if one
// can't be drawn, show the player picker on its own rather than a broken page.
class LiveSheetsBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function celebrate(soundEnabled) {
  import('canvas-confetti')
    .then(({ default: confetti }) => confetti({ particleCount: 180, spread: 90, origin: { y: 0.6 } }))
    .catch(() => { /* no confetti, the game still finished */ })
  if (soundEnabled) playGameWin()
}

function App() {
  const [state, dispatch] = useReducer(sheetReducer, EMPTY_SHEET)
  const { players, activePlayerIndex, rounds, startedAt, endedAt, sheetId, surrenderedBy } = state
  const [hydrated, setHydrated] = useState(false)
  // The game type picked for the coming round, from the matrix or the selector.
  const [selectedTypeCode, setSelectedTypeCode] = useState(null)
  // 'home' (Score) | 'history' | 'stats' | 'more' | 'players', from the
  // address: /score, /score/history, /score/stats, /score/more, /score/players.
  const { segments } = useLocation('/score')
  const view = VIEWS.includes(segments[0]) ? segments[0] : 'home'
  const setView = useCallback(v => navigate(v === 'home' ? '/score' : `/score/${v}`), [])
  const [saving, setSaving] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(() => readStorage('king-sound') !== 'off')
  const [darkMode, setDarkMode] = useState(() => readStorage('king-theme') === 'dark')
  const {
    seasons, currentChampion, currentSeasonStart,
    currentSeasonName, currentSeasonTheme,
  } = useSeasons()

  // Apply dark mode class to body
  useEffect(() => {
    document.body.classList.toggle('dark', darkMode)
    // The phone's status/address bar follows the theme too.
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', darkMode ? '#0d1117' : '#f4f4f6')
    writeStorage('king-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // Apply the current season's theme (Summer / Mountain / Christmas / Casual)
  useEffect(() => {
    applyThemeToBody(currentSeasonTheme)
  }, [currentSeasonTheme])

  // Persist sound preference
  useEffect(() => {
    writeStorage('king-sound', soundEnabled ? 'on' : 'off')
  }, [soundEnabled])

  // Load from localStorage on first mount. A snapshot from before the player
  // lists were merged (old `p1`-style ids) is dropped: the next save below
  // overwrites it.
  useEffect(() => {
    try {
      const parsed = JSON.parse(readStorage(STATE_KEY) || 'null')
      if (parsed && Array.isArray(parsed.rounds) && (parsed.players === null || Array.isArray(parsed.players))) {
        const hasLegacyIds = Array.isArray(parsed.players) && parsed.players.some((p) => /^p\d+$/.test(p.id))
        if (!hasLegacyIds) {
          dispatch({ type: 'HYDRATE', payload: {
            players: parsed.players,
            activePlayerIndex: parsed.activePlayerIndex || 0,
            rounds: parsed.rounds,
            startedAt: parsed.startedAt || null,
            endedAt: parsed.endedAt || null,
            sheetId: parsed.sheetId || null,
            surrenderedBy: parsed.surrenderedBy || null,
          } })
        }
      }
    } catch { /* a broken snapshot: start fresh */ }
    setHydrated(true)
  }, [])

  // Persist to localStorage on change
  useEffect(() => {
    if (!hydrated) return
    const snapshot = { players, activePlayerIndex, rounds, startedAt, endedAt, sheetId, surrenderedBy }
    writeStorage(STATE_KEY, JSON.stringify(snapshot))
  }, [players, activePlayerIndex, rounds, startedAt, endedAt, sheetId, surrenderedBy, hydrated])

  // Publish the game in progress so others can follow it live. The pending
  // timer and the last request are kept so that ending the sheet can wait
  // for them: a PUT landing after the DELETE would bring the sheet back.
  const publishRef = useRef({ timer: null, request: null })
  useEffect(() => {
    if (!hydrated || !players || !sheetId) return
    const pub = publishRef.current
    pub.timer = setTimeout(() => {
      pub.timer = null
      pub.request = publishLiveSheet(sheetId, { players, activePlayerIndex, rounds, startedAt, endedAt, surrenderedBy })
    }, 600)
    return () => { clearTimeout(pub.timer); pub.timer = null }
  }, [players, activePlayerIndex, rounds, startedAt, endedAt, sheetId, surrenderedBy, hydrated])

  const endLiveSheet = useCallback(async (id) => {
    if (!id) return
    const pub = publishRef.current
    clearTimeout(pub.timer)
    pub.timer = null
    await pub.request
    removeLiveSheet(id)
  }, [])

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

  const targetRoundsCount = useMemo(() => targetRoundsOf(players), [players])

  // A game is over when every round is played, or when someone surrenders.
  const gameFinished = !!(players && ((rounds.length >= targetRoundsCount && targetRoundsCount > 0) || surrenderedBy))
  const surrenderedName = surrenderedBy ? players?.find(p => p.id === surrenderedBy)?.name : null

  const finishedParticipants = useMemo(() => {
    if (!gameFinished || !players) return []
    const totals = totalsByPlayer(players, rounds)
    return players.map(p => ({ name: p.name, score: totals[p.id] }))
  }, [gameFinished, players, rounds])

  // Final game duration in seconds (null until the clock has both ends).
  const durationSeconds = startedAt && endedAt
    ? Math.max(0, Math.round((endedAt - startedAt) / 1000))
    : null

  // Save the finished game, then clear the sheet or start a rematch with the
  // same players. The server works out totals and winners from the rounds,
  // the same way the sheet does. A game that fails to save stays on screen
  // to retry; the sheet id makes a retry after a lost response store it only
  // once.
  const finishGame = useCallback(async ({ rematch = false } = {}) => {
    if (!players) return
    setSaving(true)
    let saved = false
    try {
      await saveGame({
        sheetId,
        players: players.map((p) => ({ id: p.id, name: p.name })),
        rounds,
        durationSeconds: durationSeconds ?? undefined,
        surrenderedBy: surrenderedBy ?? undefined,
      })
      saved = true
    } catch (err) {
      window.alert(`The game could not be saved (${err.message}). It is still here — try again.`)
    }
    setSaving(false)
    if (!saved) return
    endLiveSheet(sheetId)
    if (rematch) {
      if (soundEnabled) playRematch()
      dispatch({ type: 'START', players: [...players] })
    } else {
      dispatch({ type: 'RESET' })
    }
  }, [players, rounds, durationSeconds, sheetId, surrenderedBy, soundEnabled, endLiveSheet])

  const handleStart = useCallback((playersList) => {
    setSelectedTypeCode(null)
    dispatch({ type: 'START', players: playersList })
  }, [])

  const onRoundComplete = useCallback((roundRecord) => {
    dispatch({ type: 'END_ROUND', round: roundRecord })
    setSelectedTypeCode(null)
    // Celebrate here, when the last round is entered, and not whenever a
    // finished sheet is shown (a reload of an unsaved one would replay it).
    if (rounds.length + 1 >= targetRoundsCount) {
      celebrate(soundEnabled)
    } else if (soundEnabled) {
      const minScore = Math.min(...Object.values(roundRecord.scores || {}))
      if (minScore <= -40) {
        playBigPenalty()
      } else {
        playRoundEnd()
      }
    }
  }, [soundEnabled, rounds.length, targetRoundsCount])

  const onUndoLastRound = useCallback(() => {
    if (!players || rounds.length === 0) return
    setSelectedTypeCode(null)
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

  const onSurrender = useCallback((playerId) => {
    setSelectedTypeCode(null)
    dispatch({ type: 'SURRENDER', playerId })
    celebrate(soundEnabled)
  }, [soundEnabled])

  const handleReset = useCallback(() => {
    const ok = window.confirm('Are you sure you want to reset the current game? This will clear all progress.')
    if (!ok) return
    endLiveSheet(sheetId)
    dispatch({ type: 'RESET' })
    setView('home')
  }, [sheetId, endLiveSheet, setView])

  return (
    <div className="app">
      <ThemeDecorations themeId={currentSeasonTheme} />
      <header className="app-header">
        {/* King Online is the site's home page (its own root layout) */}
        <a className="home-link" href="/" title="King Online"><ArrowLeft size={16} /> King Online</a>
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
        <Suspense fallback={PageLoading}>
          {view === 'players' && (
            <PlayersPage onBack={() => goBack('/score/more')} currentChampion={currentChampion} />
          )}

          {view === 'history' && (
            <WinnersPage seasons={seasons} />
          )}

          {view === 'stats' && (
            <StatsPage
              currentSeasonStart={currentSeasonStart}
              onBack={() => goBack('/score')}
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
              onResetGame={handleReset}
            />
          )}
        </Suspense>

        {view === 'home' && !players && (
          <LiveSheetsBoundary fallback={<PlayerInput onStart={handleStart} />}>
            <LiveSheets>
              <PlayerInput onStart={handleStart} />
            </LiveSheets>
          </LiveSheetsBoundary>
        )}

        {view === 'home' && players && !gameFinished && (
          <>
            <div className="game-toolbar">
              <SurrenderButton players={players} roundsPlayed={rounds.length} onSurrender={onSurrender} />
              <button type="button" className="link danger-link reset-game-btn" onClick={handleReset}>
                <Trash2 size={13} /> Reset game
              </button>
            </div>
            <GameTypeMatrix
              players={players}
              usedTypesByPlayer={usedTypesByPlayer}
              activePlayerIndex={activePlayerIndex}
              onPreselect={setSelectedTypeCode}
              playerColors={PLAYER_COLORS}
              currentChampion={currentChampion}
            />
            <GameTypeSelector
              // A new round (or an undone one) starts with a clean form.
              key={rounds.length}
              players={players}
              activePlayerIndex={activePlayerIndex}
              usedTypesByPlayer={usedTypesByPlayer}
              selectedTypeCode={selectedTypeCode}
              onSelectType={setSelectedTypeCode}
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
            {/* The final round can still be fixed or undone until the game is
                saved; a surrendered game is taken back with Resume instead. */}
            {surrenderedBy && (
              <div className="surrender-note">
                <Flag size={14} />
                <span><strong>{surrenderedName ?? 'A player'}</strong> surrendered after round {rounds.length} of {targetRoundsCount}.</span>
                <button type="button" className="link reset-game-btn" disabled={saving} onClick={() => dispatch({ type: 'RESUME' })}>
                  Resume game
                </button>
              </div>
            )}
            <ScoreTable
              players={players}
              rounds={rounds}
              gameFinished
              onEditLastRound={saving || surrenderedBy ? undefined : onEditLastRound}
              onUndoLastRound={saving || surrenderedBy ? undefined : onUndoLastRound}
              playerColors={PLAYER_COLORS}
              currentChampion={currentChampion}
            />
            {durationSeconds != null && (
              <div className="game-duration-note">
                <Timer size={14} /> Game time: <strong>{formatDuration(durationSeconds)}</strong>
              </div>
            )}
            <div className="actions center">
              <button className="primary" disabled={saving} onClick={() => finishGame()}>
                {saving ? 'Saving...' : 'Complete'}
              </button>
              <button className="primary success" disabled={saving} onClick={() => finishGame({ rematch: true })}>
                {saving ? '...' : <><RefreshCw size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Rematch</>}
              </button>
            </div>
            <Suspense fallback={null}>
              <ScoreChart players={players} rounds={rounds} />
              <GameAnalytics players={players} rounds={rounds} participants={finishedParticipants} />
            </Suspense>
          </>
        )}
      </main>

      <BottomNav view={view} onNavigate={setView} />
    </div>
  )
}

export default App
