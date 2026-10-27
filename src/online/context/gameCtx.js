import { getProfileToken } from '../lib/profiles'
import { createActions } from './gameActions'

/**
 * The values the socket listeners read. They're registered once, so they go
 * through these mutable refs rather than through React state.
 */
export function createGameRefs() {
  const ref = (current) => ({ current })
  return {
    socket: ref(null),
    // What a reconnect needs to put us back: our room, name and tournament.
    roomCode: ref(''),
    myName: ref(''),
    tournamentCode: ref(''),
    mySeat: ref(null),
    players: ref([]),
    appPhase: ref('lobby'),
    publicSeat: ref(null),
    spectating: ref(null),
    reconnecting: ref(false),
    hadDisconnect: ref(false),
    // Set by a reconnect: the next snapshot is the whole truth, including that
    // no quit vote is running (snapshots don't carry one).
    snapshotAfterRejoin: ref(false),
    playPending: ref(false),
    // The table version of the last game event we applied, and its room: a
    // background resync at that version gets a short "up to date" reply
    // instead of the whole table.
    stateVersion: ref(null),
    trickTimers: ref([]),
    // The switch to the results screen, a moment after game-over. Cancelled
    // by anything that moves us to another table first (the tournament final).
    gameOverTimer: ref(null),
    disconnectTimers: ref({}),   // name -> grace timer
    typingSentAt: ref(0),
  }
}

/**
 * The provider's toolbox for the socket handlers and the actions: the refs,
 * the table dispatch, the chat helpers, the audio pool, every state setter
 * (`set`, by state name) and the helpers built over them. Built once —
 * everything in it keeps its identity — and plain, so it can be driven
 * outside React too.
 */
export function createGameCtx({ refs, dispatch, chat, unlockAudio, playClip, set }) {
  const ctx = {
    refs, dispatch, chat, unlockAudio, playClip,
    setConnected: set.connected,
    setPlayers: set.players,
    setIsCreator: set.isCreator,
    setAppPhase: set.appPhase,
    setRoomMode: set.roomMode,
    setGameStartedAt: set.gameStartedAt,
    setFinalResults: set.finalResults,
    setResumableSeat: set.resumableSeat,
    setPublicSeatMode: set.publicSeatMode,
    setPublicRoom: set.publicRoom,
    setOnlinePlayers: set.onlinePlayers,
    setLiveGames: set.liveGames,
    setTournament: set.tournament,
    setTournamentList: set.tournamentList,
    setTournamentOverview: set.tournamentOverview,
    setTournamentSeat: set.tournamentSeat,
    setQuitProposal: set.quitProposal,
    setRematch: set.rematch,

    // State the listeners also read: the ref moves with it.
    setRoom: (code) => { refs.roomCode.current = code; set.roomCode(code) },
    setSeat: (seat) => { refs.mySeat.current = seat; set.mySeat(seat) },
    setPublicSeat: (v) => { refs.publicSeat.current = v; set.publicSeat(v) },
    setSpectating: (v) => { refs.spectating.current = v; set.spectating(v) },
    setReconnecting: (v) => { refs.reconnecting.current = v; set.reconnecting(v) },
    enterTournament: (t) => {
      // Once the final is drawn, an entrant not in it is out: still
      // following the bracket, but free to play elsewhere.
      const me = String(refs.myName.current || '').toLowerCase()
      const finalists = t?.finalists || []
      const eliminated = !!t && finalists.length > 0
        && !finalists.some((n) => String(n).toLowerCase() === me)
      set.tournament(t && { ...t, eliminated })
      refs.tournamentCode.current = t?.code || ''
    },

    addToast: (message, type = 'info') => {
      const id = Date.now() + Math.random()
      set.toasts(prev => [...prev, { id, message, type }])
      setTimeout(() => set.toasts(prev => prev.filter(t => t.id !== id)), 4000)
    },

    // Who we play as, on every emit that seats or names us: the profile's
    // session token (the server takes the name and photo from it), plus
    // the name for a server that can't resolve the token.
    identity: (name = refs.myName.current) => ({
      playerName: name, profileToken: getProfileToken(),
    }),

    // Watchdog / tab-resume resync. Sends our table version so an unchanged
    // table costs a one-line reply. (A rejected play resyncs without it: our
    // optimistic hand differs from the server's even at the same version.)
    requestState: () => {
      const v = refs.stateVersion.current
      refs.socket.current?.emit('request-state',
        v && v.room === refs.roomCode.current ? { version: v.version } : {})
    },

    seatName: (seat, list = refs.players.current) =>
      (list || []).find(p => p.seat === seat)?.name || `მოთამაშე ${seat}`,

    clearTrickTimers: () => {
      refs.trickTimers.current.forEach(t => clearTimeout(t))
      refs.trickTimers.current = []
    },
    clearGameOverTimer: () => {
      clearTimeout(refs.gameOverTimer.current)
      refs.gameOverTimer.current = null
    },

    // A player dropped: show it once they've been gone a few seconds.
    markDisconnected: (name) => {
      const timers = refs.disconnectTimers.current
      clearTimeout(timers[name])
      timers[name] = setTimeout(() => {
        delete timers[name]
        set.disconnectedPlayers(prev => (prev.includes(name) ? prev : [...prev, name]))
        ctx.addToast(`${name} გაითიშა…`, 'warning')
      }, 5000)
    },
    // One player is back (or, with no name, everyone).
    clearDisconnected: (name) => {
      const timers = refs.disconnectTimers.current
      if (name === undefined) {
        Object.values(timers).forEach(clearTimeout)
        refs.disconnectTimers.current = {}
        set.disconnectedPlayers([])
        return
      }
      clearTimeout(timers[name])
      delete timers[name]
      set.disconnectedPlayers(prev => (prev.includes(name) ? prev.filter(n => n !== name) : prev))
    },

    // Results belong to the room they were played in.
    forgetResults: () => set.finalResults(null),

    // Everything that belongs to one table and must not follow us to the
    // next: its chat (voice clips included), bubbles, typing dots, the
    // "player disconnected" banner, a quit vote, the last trick and
    // discard picks.
    resetRoomScopedState: () => {
      chat.reset()
      ctx.clearDisconnected()
      set.quitProposal(null)
      dispatch({ type: 'room-reset' })
    },

    // True when an emit would reach the server in our seat. socket.io
    // buffers emits made while offline and flushes them BEFORE our rejoin,
    // so the server sees a socket with no seat and refuses them.
    canSend: () => !!refs.socket.current?.connected && !refs.reconnecting.current,

    // The server has us back: drop the banner and send the chat typed
    // while we were away.
    endReconnect: ({ flushChat = true } = {}) => {
      refs.hadDisconnect.current = false
      ctx.setReconnecting(false)
      if (!flushChat) return
      chat.takeQueue().forEach(message => refs.socket.current?.emit('chat-message', { message }))
    },
  }
  ctx.actions = createActions(ctx)
  return ctx
}
