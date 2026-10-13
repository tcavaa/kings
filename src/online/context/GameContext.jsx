import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useState } from 'react'
import { tableReducer, initialTable } from './tableReducer'
import { createGameRefs, createGameCtx } from './gameCtx'
import { useChatState } from './useChatState'
import { useReactionAudio } from './useReactionAudio'
import { useGameSocket } from './useGameSocket'

// Four contexts, split by how often they change, so a busy one doesn't
// re-render screens that don't read it:
//  - GameContext: our room, the table and every action (useGame).
//  - ChatContext: chat traffic, at keystroke frequency (useChat) — only the
//    2-3 chat consumers re-render, not every useGame() component + canvas.
//  - LobbyContext: homepage lists the server broadcasts to every socket
//    (useLobby) — presence changes no longer re-render a game in progress.
//  - ToastContext: the toast stack (useToasts).
const GameContext = createContext(null)
const ChatContext = createContext(null)
const LobbyContext = createContext(null)
const ToastContext = createContext(null)

const EMPTY_TABLE = { roomCode: null, seats: [] }

export function GameProvider({ children }) {
  const [connected, setConnected] = useState(false)

  const [roomCode, setRoomCode]   = useState('')
  const [players, setPlayers]     = useState([])
  const [mySeat, setMySeat]       = useState(null)
  const [isCreator, setIsCreator] = useState(false)
  const [appPhase, setAppPhase]   = useState('lobby')
  // Mode of the room we're currently in ('public' | 'championship') — shown
  // in the waiting room and on the game-over screen.
  const [roomMode, setRoomMode] = useState('public')
  // Server wall-clock of the deal, origin for the in-game elapsed timer.
  const [gameStartedAt, setGameStartedAt] = useState(null)
  const [finalResults, setFinalResults]   = useState(null)

  const [table, dispatch] = useReducer(tableReducer, initialTable)

  // Names of seated players who dropped and haven't come back yet (shown
  // after a short grace period, see markDisconnected).
  const [disconnectedPlayers, setDisconnectedPlayers] = useState([])
  // True from the moment our own socket goes offline until it reconnects
  // AND the server confirms re-attachment (room-joined { reconnected: true }).
  // Drives the self-disconnect banner.
  const [reconnecting, setReconnecting] = useState(false)

  // ── Public quick-match room (homepage) ──────────────────────────────────
  // Two homepage quick-match tables — one casual, one championship — whose
  // live snapshot is broadcast to every socket. `publicSeat` is OUR seat
  // there (null = not sitting); while seated the user stays on the lobby
  // screen — the game only starts (and appPhase flips) when the server sees
  // the 3rd seat fill.
  const [publicRoom, setPublicRoom] = useState({ public: EMPTY_TABLE, championship: EMPTY_TABLE })
  const [publicSeat, setPublicSeat] = useState(null)
  // Which quick-match table the seat belongs to ('public' | 'championship').
  const [publicSeatMode, setPublicSeatMode] = useState(null)
  // A seat we *could* go back to, read from localStorage on boot. Offered as
  // a button in the lobby — never applied on our own (see publicSeatStore).
  const [resumableSeat, setResumableSeat] = useState(null)
  // Homepage: who's around, and which King tables can be watched.
  const [onlinePlayers, setOnlinePlayers] = useState([])
  const [liveGames, setLiveGames]         = useState([])

  // ── Tournament ──────────────────────────────────────────────────────────
  // `tournament` is our own lobby/bracket membership; `tournamentOverview` is
  // the cross-table scoreboard; `tournamentSeat` tags the room we're playing
  // as a bracket table; `spectating` is set while watching someone else's.
  const [tournament, setTournament]                 = useState(null)
  const [tournamentList, setTournamentList]         = useState([])
  const [tournamentOverview, setTournamentOverview] = useState(null)
  const [tournamentSeat, setTournamentSeat]         = useState(null)
  const [spectating, setSpectating]                 = useState(null)

  // ── Quit-round / surrender vote ─────────────────────────────────────────
  // Set while a proposal is waiting on votes:
  //   { kind: 'round'|'game', proposerSeat, proposerName, acceptedSeats, voters }
  // Cleared when it passes (round-complete / game-over lands), is declined,
  // or expires server-side.
  const [quitProposal, setQuitProposal] = useState(null)

  // ── Rematch coordination ────────────────────────────────────────────────
  // From the server's `rematch-status` broadcast after the game ends:
  // `newRoomCode` is the rematch lobby, `joinedOldSeats` the seats (of the
  // finished room) that have clicked Play Again — the game-over screen marks
  // them as ready.
  const [rematch, setRematch] = useState({ newRoomCode: null, joinedOldSeats: [] })

  const [toasts, setToasts] = useState([])

  const { chatMessages, chatBubbles, typingSeats, chat } = useChatState()
  const { unlockAudio, playClip } = useReactionAudio(appPhase)

  // The socket listeners are registered once, so they read the current
  // values through refs (see gameCtx).
  const [refs] = useState(createGameRefs)

  // Keep the refs in step with the state — cheaper than threading them
  // through every setter call site. The play lock is synced before paint, so
  // a second tap can't slip in between the ack and the ref.
  useEffect(() => { refs.players.current = players }, [refs, players])
  useEffect(() => { refs.appPhase.current = appPhase }, [refs, appPhase])
  useLayoutEffect(() => { refs.playPending.current = table.playPending }, [refs, table.playPending])

  // The toolbox the socket handlers and actions share. Everything in it is
  // a ref, a state setter or a helper over those, so it is built once.
  const [ctx] = useState(() => createGameCtx({
    refs, dispatch, chat, unlockAudio, playClip,
    set: {
      connected: setConnected, roomCode: setRoomCode, players: setPlayers, mySeat: setMySeat,
      isCreator: setIsCreator, appPhase: setAppPhase, roomMode: setRoomMode,
      gameStartedAt: setGameStartedAt, finalResults: setFinalResults,
      disconnectedPlayers: setDisconnectedPlayers, reconnecting: setReconnecting,
      publicRoom: setPublicRoom, publicSeat: setPublicSeat, publicSeatMode: setPublicSeatMode,
      resumableSeat: setResumableSeat, onlinePlayers: setOnlinePlayers, liveGames: setLiveGames,
      tournament: setTournament, tournamentList: setTournamentList,
      tournamentOverview: setTournamentOverview, tournamentSeat: setTournamentSeat,
      spectating: setSpectating, quitProposal: setQuitProposal, rematch: setRematch,
      toasts: setToasts,
    },
  }))
  const actions = ctx.actions

  useGameSocket(ctx)

  // ── Desync recovery watchdog ──────────────────────────────────────────────
  // If we sit "waiting on someone else to play" for too long, the likeliest
  // cause is a dropped socket event that left our view stale: we still think
  // it's their turn while the server has already advanced to ours → a
  // deadlock the user could only escape by refreshing. Quietly re-pull the
  // authoritative snapshot.
  //
  // Armed ONLY while it's *not* our turn — when it's our turn we already hold
  // everything we need, so the active player never triggers a resync (no
  // flicker for the person actually thinking). The timer is re-armed every
  // time the turn changes; a normal hand-off clears it long before it fires.
  const { gamePhase, currentTurn, leaderSeat } = table
  useEffect(() => {
    // Who must act right now: the current player while a trick is in
    // progress, or the leader during the per-round decision phases.
    const ACTIVE_PHASES = ['playing', 'type_selection', 'trump_selection', 'discard']
    if (!ACTIVE_PHASES.includes(gamePhase)) return
    const actorSeat = gamePhase === 'playing' ? currentTurn : leaderSeat
    if (actorSeat === null || actorSeat === undefined || actorSeat === mySeat) return
    const t = setTimeout(() => {
      // Nothing to gain while hidden or offline: the visibility and
      // reconnect paths resync on their own when we're back.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (!ctx.canSend()) return
      ctx.requestState()
    }, 9000)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePhase, currentTurn, leaderSeat, mySeat])

  // Mirrors the server's `canSpeak`: a watcher who wandered in from the
  // homepage gets text and reactions only, while a tournament watcher (a
  // fellow entrant, and accountable) keeps voice and the sound board. Used to
  // hide controls the server would refuse anyway.
  const canSpeak = !spectating || !!spectating.tournamentId

  // The banner names everyone who is still away.
  const disconnectedPlayer = disconnectedPlayers.length ? disconnectedPlayers.join(' და ') : null

  const gameValue = useMemo(() => ({
    connected,
    roomCode, players, mySeat, isCreator,
    appPhase,
    ...table,
    finalResults,
    disconnectedPlayer, reconnecting,
    quitProposal,
    publicSeat, publicSeatMode, resumableSeat,
    gameStartedAt,
    tournament, tournamentSeat, spectating,
    roomMode,
    rematch,
    ...actions,
  }), [
    connected,
    roomCode, players, mySeat, isCreator,
    appPhase,
    table,
    finalResults,
    disconnectedPlayer, reconnecting,
    quitProposal,
    publicSeat, publicSeatMode, resumableSeat,
    gameStartedAt,
    tournament, tournamentSeat, spectating,
    roomMode,
    rematch,
    actions,
  ])

  const chatValue = useMemo(() => ({
    chatMessages, chatBubbles, typingSeats, canSpeak,
    sendChat: actions.sendChat,
    sendVoice: actions.sendVoice,
    sendTyping: actions.sendTyping,
    playSound: actions.playSound,
    reactToMessage: actions.reactToMessage,
  }), [chatMessages, chatBubbles, typingSeats, canSpeak, actions])

  const lobbyValue = useMemo(() => ({
    publicRoom, onlinePlayers, liveGames, tournamentList, tournamentOverview,
  }), [publicRoom, onlinePlayers, liveGames, tournamentList, tournamentOverview])

  const toastValue = useMemo(() => ({ toasts }), [toasts])

  return (
    <GameContext.Provider value={gameValue}>
      <LobbyContext.Provider value={lobbyValue}>
        <ToastContext.Provider value={toastValue}>
          <ChatContext.Provider value={chatValue}>
            {children}
          </ChatContext.Provider>
        </ToastContext.Provider>
      </LobbyContext.Provider>
    </GameContext.Provider>
  )
}

/** Our room, the table and every action. */
export const useGame = () => useContext(GameContext)
/** The table chat. */
export const useChat = () => useContext(ChatContext)
/** Homepage lists: quick-match tables, who's online, live games, tournaments. */
export const useLobby = () => useContext(LobbyContext)
/** The toast stack. */
export const useToasts = () => useContext(ToastContext)
