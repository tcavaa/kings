import { readSeatMarker, clearSeatMarker } from '../lib/publicSeatStore'

// How long a card play may wait for the server's answer before we resync.
const PLAY_ACK_MS = 4000

/**
 * Everything the UI can ask of the game server. Built once from the
 * provider's toolbox, so every action keeps one identity for the app's
 * lifetime and never re-renders a consumer by itself.
 */
export function createActions(ctx) {
  const { refs, dispatch, chat } = ctx
  const emit = (event, payload) => refs.socket.current?.emit(event, payload)
  const setMe = (name) => { refs.myName.current = name }

  // Table actions are refused while offline instead of being buffered: the
  // reconnect banner is up and the hand is locked then (see canSend).
  const tableAction = (fn) => (...args) => {
    if (!ctx.canSend()) return ctx.addToast('კავშირი აღდგება — სცადე ცოტა ხანში.', 'warning')
    return fn(...args)
  }

  return {
    addToast: ctx.addToast,

    // ── rooms ───────────────────────────────────────────────────────────
    createRoom(name, mode = 'public') {
      ctx.unlockAudio()
      setMe(name)
      emit('create-room', { ...ctx.identity(name), mode })
    },

    joinRoom(code, name) {
      ctx.unlockAudio()
      setMe(name)
      // Pre-stash the room code too — the very first join is the only place
      // we know it before the server's `room-joined` round-trip lands, and
      // it drives the auto-rejoin path on a subsequent disconnect. A refused
      // join clears it again (see the `error` handler).
      refs.roomCode.current = code
      emit('join-room', { roomCode: code, ...ctx.identity(name) })
    },

    startGame() { emit('start-game') },

    // Triggered from the Play Again button on the game-over screen. The new
    // room keeps the identity of the seat we held.
    requestRematch() {
      ctx.unlockAudio()
      emit('request-rematch')
    },

    leaveRoom() {
      emit('leave-room')
      ctx.clearGameOverTimer()
      ctx.setAppPhase('lobby')
      ctx.setRoom('')
      ctx.setPlayers([])
      ctx.setSeat(null)
      ctx.setIsCreator(false)
      ctx.setPublicSeat(null)
      ctx.setPublicSeatMode(null)
      ctx.setRoomMode('public')
      ctx.setGameStartedAt(null)
      clearSeatMarker()
      ctx.resetRoomScopedState()
      ctx.forgetResults()
    },

    // ── the table ───────────────────────────────────────────────────────
    selectGameType: tableAction((typeCode) => emit('select-game-type', { typeCode })),
    selectTrump: tableAction((suit) => emit('select-trump', { suit })),
    discardCards: tableAction((cards) => {
      emit('discard-cards', { cards })
      dispatch({ type: 'discards-cleared' })
    }),
    toggleDiscard(card) { dispatch({ type: 'toggle-discard', card }) },

    playCard(card) {
      if (refs.playPending.current) return
      if (!ctx.canSend()) return ctx.addToast('კავშირი აღდგება — სცადე ცოტა ხანში.', 'warning')
      refs.playPending.current = true
      dispatch({ type: 'play-sent', card })
      emit('play-card', { card })
      // The card is already out of the hand and the hand is locked until the
      // server answers. If the play was lost on its way (a connection that
      // died quietly), nothing would ever unlock it: the player sees their
      // turn, one card more than the others and no way to play. Ask for the
      // table instead, which also notices a dead connection.
      clearTimeout(refs.playTimer.current)
      refs.playTimer.current = setTimeout(() => {
        refs.playTimer.current = null
        if (refs.playPending.current) ctx.requestState({ full: true })
      }, PLAY_ACK_MS)
    },

    nextRound: tableAction(() => emit('next-round')),
    proposeQuit: tableAction((kind) => emit('propose-quit', { kind })),
    voteQuit: tableAction((accept) => emit('vote-quit', { accept })),

    // ── chat ────────────────────────────────────────────────────────────
    sendChat(message) {
      if (!message || !message.trim()) return
      // Offline: hold it until we're back in our seat (see endReconnect).
      if (!ctx.canSend()) {
        chat.queue(message.trim())
        return
      }
      emit('chat-message', { message: message.trim() })
    },

    // Ship a recorded clip to the room. 400 KB matches the server's hard cap.
    async sendVoice(blob, duration = 0) {
      if (!blob || !blob.size) return
      if (blob.size > 400 * 1024) {
        ctx.addToast('ჩანაწერი ძალიან დიდი გამოვიდა.', 'error')
        return
      }
      try {
        const buf = await blob.arrayBuffer()
        emit('voice-message', { audio: buf, mime: blob.type || 'audio/webm', duration })
      } catch { /* ignore */ }
    },

    playSound(soundId, targetSeat = null) { emit('play-sound', { soundId, targetSeat }) },
    reactToMessage(messageId, emoji) { emit('chat-react', { messageId, emoji }) },

    // Throttled "I'm typing" ping — at most one every 1.2s while keys are
    // being pressed; receivers expire the indicator on their own 2.5s timer.
    sendTyping() {
      const now = Date.now()
      if (now - refs.typingSentAt.current < 1200) return
      refs.typingSentAt.current = now
      emit('chat-typing')
    },

    // ── public quick-match ──────────────────────────────────────────────
    sitPublic(name, emoji = null, mode = 'public') {
      ctx.unlockAudio()
      setMe(name)
      emit('sit-public', { ...ctx.identity(name), emoji, mode })
    },
    standPublic() { emit('stand-public') },
    setPublicEmoji(emoji) { emit('set-public-emoji', { emoji }) },

    // A stored quick-match seat, resumed by the user. `rejoin-public` only
    // ever re-attaches to a seat already holding this name, so the worst a
    // stale marker can do is come back as `public-rejoin-failed`.
    // Deliberately a click, not a page-load effect.
    resumeSeat() {
      const saved = readSeatMarker()
      if (!saved) { ctx.setResumableSeat(null); return }
      ctx.unlockAudio()
      setMe(saved.name)
      emit('rejoin-public', { roomCode: saved.roomCode, ...ctx.identity(saved.name) })
      ctx.setResumableSeat(null)
    },
    dismissResumeSeat() {
      clearSeatMarker()
      ctx.setResumableSeat(null)
    },

    // ── tournaments ─────────────────────────────────────────────────────
    createTournament(name, size) {
      ctx.unlockAudio()
      setMe(name)
      emit('tournament-create', { ...ctx.identity(name), size })
    },
    joinTournament(code, name) {
      ctx.unlockAudio()
      setMe(name)
      emit('tournament-join', { code: String(code || '').toUpperCase(), ...ctx.identity(name) })
    },
    leaveTournament() { emit('tournament-leave') },
    // Put away a finished tournament's result in the lobby.
    dismissTournament() {
      ctx.enterTournament(null)
      ctx.setTournamentOverview(null)
    },
    refreshTournaments() { emit('tournament-list') },
    // Any tournament's bracket by its code; without one, our own.
    refreshOverview(code) { emit('tournament-overview', code ? { code } : {}) },
    spectateTable(roomCode) {
      ctx.unlockAudio()
      emit('tournament-spectate', { roomCode, ...ctx.identity() })
    },

    // ── homepage presence and watching ──────────────────────────────────
    announcePresence(name) {
      if (!name) return
      setMe(name)
      emit('announce-presence', ctx.identity(name))
    },
    refreshLobby() { emit('lobby-info') },
    // The name is passed in rather than read off the ref: watching happens
    // straight from the lobby, before any room has set it.
    watchGame(roomCode, name) {
      const who = String(name || refs.myName.current || '').trim()
      if (!who) return
      ctx.unlockAudio()
      setMe(who)
      emit('watch-game', { roomCode, ...ctx.identity(who) })
    },
    // `stop-watching` covers both kinds of watcher — it clears the same
    // spectator registry entry and additionally refreshes the homepage lists.
    stopSpectating() { emit('stop-watching') },
  }
}
