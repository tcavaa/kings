import { writeSeatMarker, clearSeatMarker } from '../../lib/publicSeatStore'
import { dropProfileSession } from '../../lib/profiles'

/**
 * Which table we're at, and how we got there: private rooms, the homepage
 * quick-match tables, tournaments, watching, rematches, the players around
 * us and the quit votes. `ctx` is the provider's toolbox (see GameContext).
 */
export function registerRoomEvents(socket, ctx) {
  const { refs } = ctx

  // ── Rematch broadcast ───────────────────────────────────────────────
  // Server fans this out to every socket still in the (just-finished)
  // old room whenever a Play Again click lands: the new lobby code +
  // the list of old seats that have signed up so far.
  socket.on('rematch-status', ({ newRoomCode, joinedOldSeats }) => {
    ctx.setRematch({
      newRoomCode: newRoomCode || null,
      joinedOldSeats: Array.isArray(joinedOldSeats) ? joinedOldSeats : [],
    })
  })

  socket.on('room-created', ({ roomCode: code, seat, mode }) => {
    ctx.resetRoomScopedState()
    ctx.forgetResults()
    ctx.setRoom(code)
    ctx.setSeat(seat)
    ctx.setIsCreator(true)
    ctx.setRoomMode(mode === 'championship' ? 'championship' : 'public')
    ctx.setAppPhase('waiting')
  })

  socket.on('room-joined', ({ roomCode: code, seat, reconnected, status, mode, tournament: tournamentTag, startedAt }) => {
    ctx.clearGameOverTimer()
    // A different table (not our own seat coming back): start clean.
    if (!reconnected || code !== refs.roomCode.current) {
      ctx.resetRoomScopedState()
      ctx.forgetResults()
    }
    ctx.setRoom(code)
    ctx.setSeat(seat)
    ctx.setIsCreator(seat === 0)
    if (mode) ctx.setRoomMode(mode === 'championship' ? 'championship' : 'public')
    if (startedAt) ctx.setGameStartedAt(startedAt)
    // Set when the server seats us at a bracket table; drives the HUD's
    // tournament button and blocks the quit/rematch affordances.
    ctx.setTournamentSeat(tournamentTag || null)
    if (tournamentTag) ctx.setSpectating(null)
    if (reconnected) {
      // Server re-bound this socket to the existing seat. Pick the
      // right screen based on the room's lifecycle: lobby reconnects go
      // back to WaitingRoom, finished games go to the results screen
      // (never the table), and live games rehydrate via the follow-up
      // `game-state` snapshot.
      ctx.setAppPhase(status === 'waiting' ? 'waiting' : status === 'finished' ? 'gameover' : 'game')
      refs.snapshotAfterRejoin.current = true
      ctx.endReconnect()
    } else {
      ctx.setAppPhase('waiting')
    }
  })

  // Roster events name their room: one from a table we've since left (its
  // last events can still arrive) must not overwrite this table's players.
  const otherRoom = (code) => !!code && code !== refs.roomCode.current

  socket.on('player-joined', ({ players: p, roomCode }) => {
    if (!otherRoom(roomCode)) ctx.setPlayers(p)
  })
  // player-left's roster carries no photos or connection flags; keep the
  // ones we already have for players who are still there.
  socket.on('player-left', ({ players: p, roomCode }) => otherRoom(roomCode) || ctx.setPlayers(prev => (p || []).map(np => {
    const old = prev.find(o => o.seat === np.seat && o.name === np.name)
    return old ? { ...old, ...np } : np
  })))

  // Brief network blips happen all the time on mobile; suppress the
  // disconnect banner for a few seconds so a fast auto-rejoin (which
  // socket.io-client does for free) goes unnoticed. One timer per player,
  // so two drops close together are both shown and one coming back doesn't
  // hide the other.
  socket.on('player-disconnected', ({ playerName, players: p, roomCode }) => {
    if (otherRoom(roomCode)) return
    if (p) ctx.setPlayers(p)
    if (playerName) ctx.markDisconnected(playerName)
  })

  socket.on('player-reconnected', ({ playerName, players: p, roomCode }) => {
    if (otherRoom(roomCode)) return
    // No toast here — if the rejoin happens inside the grace window the
    // user never saw a drop in the first place, and a stray "reconnected"
    // banner would just confuse them.
    ctx.clearDisconnected(playerName || undefined)
    if (p) ctx.setPlayers(p)
  })

  // ── Quick-match tables (casual + championship) ─────────────────────
  // Off the homepage table: forget the seat and its room.
  const standDownPublic = () => {
    ctx.setPublicSeat(null)
    ctx.setPublicSeatMode(null)
    ctx.setRoom('')
    ctx.setSeat(null)
    ctx.setIsCreator(false)
    clearSeatMarker()
    ctx.resetRoomScopedState()
  }

  socket.on('public-room', (view = {}) => {
    const norm = (t) => ({
      roomCode: t?.roomCode || null,
      seats: Array.isArray(t?.seats) ? t.seats : [],
    })
    // Legacy single-table payloads (server mid-deploy) land as the casual table.
    const v = view.public || view.championship
      ? { public: norm(view.public), championship: norm(view.championship) }
      : { public: norm(view), championship: { roomCode: null, seats: [] } }
    ctx.setPublicRoom(v)
    if (refs.publicSeat.current === null) return
    const myTable = [v.public, v.championship].find(t => t.roomCode && t.roomCode === refs.roomCode.current)
    if (myTable) {
      // Still the same table — but if our seat is gone the server swept
      // us out (disconnect grace expired). Stand down locally.
      if (!myTable.seats.some(s => s.seat === refs.publicSeat.current)) standDownPublic()
    } else {
      // The quick-match lobby moved on — either our table filled and the
      // game is starting (game-started handles the transition; keep the
      // room refs for reconnection) or a fresh table opened. Either way
      // we're no longer "seated on the homepage".
      ctx.setPublicSeat(null)
      ctx.setPublicSeatMode(null)
    }
  })

  socket.on('public-seated', ({ roomCode: code, seat, mode }) => {
    // Also the answer to rejoin-public after a blip.
    if (refs.hadDisconnect.current) ctx.endReconnect({ flushChat: false })
    ctx.setRoom(code)
    ctx.setSeat(seat)
    ctx.setIsCreator(seat === 0)
    ctx.setPublicSeat(seat)
    const tableMode = mode === 'championship' ? 'championship' : 'public'
    ctx.setPublicSeatMode(tableMode)
    ctx.setRoomMode(tableMode)
    // Remember the seat so the lobby can offer it back after a refresh.
    writeSeatMarker(code, refs.myName.current)
    ctx.setResumableSeat(null)
  })

  socket.on('public-unseated', standDownPublic)

  socket.on('public-rejoin-failed', () => {
    // After a blip the seat we held is gone; from the lobby's rejoin button
    // there was no seat to begin with.
    if (refs.publicSeat.current !== null) standDownPublic()
    ctx.setPublicSeat(null)
    ctx.setPublicSeatMode(null)
    clearSeatMarker()
    ctx.setResumableSeat(null)
    if (refs.hadDisconnect.current) ctx.endReconnect({ flushChat: false })
  })

  // ── Tournament ──────────────────────────────────────────────────────
  socket.on('tournament-joined', (t) => {
    ctx.enterTournament(t)
    // A reconnect in a tournament lobby has no room-joined to wait for.
    if (!refs.roomCode.current) ctx.endReconnect({ flushChat: false })
  })
  socket.on('tournament-state', (t) => { ctx.enterTournament(t) })
  socket.on('tournament-left',  ()  => { ctx.enterTournament(null) })

  socket.on('tournament-final', () => {
    ctx.addToast('ფინალი იწყება!', 'success')
  })

  socket.on('tournament-complete', (payload) => {
    refs.tournamentCode.current = ''
    // Kept (as 'done', with its winners) so the lobby can show the result
    // until it's dismissed.
    ctx.setTournament(prev => prev && { ...prev, status: 'done', winners: payload.winners || [] })
    const names = (payload.winners || []).map(w => w.name).join(' და ')
    if (names) ctx.addToast(`ტურნირის გამარჯვებული: ${names} 🏆`, 'success')
  })

  // ── Watching someone else's table ────────────────────────────────────
  // The server sends a masked snapshot, so `hand` arrives empty and the
  // canvas simply has nothing of ours to draw.
  socket.on('spectate-started', (payload) => {
    ctx.clearGameOverTimer()
    // Re-watching the same table after a blip keeps its chat.
    if (payload.roomCode !== refs.roomCode.current) {
      ctx.resetRoomScopedState()
      ctx.forgetResults()
    }
    if (refs.hadDisconnect.current) ctx.endReconnect()
    ctx.setSpectating(payload)
    if (payload.startedAt) ctx.setGameStartedAt(payload.startedAt)
    ctx.setRoom(payload.roomCode)
    ctx.setSeat(null)
    ctx.dispatch({ type: 'hand-cleared' })
    ctx.setAppPhase('game')
  })

  socket.on('spectate-stopped', () => {
    ctx.clearGameOverTimer()
    ctx.resetRoomScopedState()
    ctx.setSpectating(null)
    // Not our room: a reconnect must not try to join the table we watched.
    ctx.setRoom('')
    ctx.dispatch({ type: 'hand-cleared' })
    ctx.setAppPhase('lobby')
  })

  // ── Quit-round / surrender votes ────────────────────────────────────
  socket.on('quit-proposal', ({ kind, proposerSeat, proposerName, acceptedSeats, voters }) => {
    ctx.setQuitProposal({
      kind,
      proposerSeat,
      proposerName,
      acceptedSeats: Array.isArray(acceptedSeats) ? acceptedSeats : [proposerSeat],
      // Seats that must agree — a player who left for good doesn't vote.
      voters: Array.isArray(voters) ? voters : [0, 1, 2],
    })
  })

  socket.on('quit-rejected', ({ kind, voterSeat, reason }) => {
    ctx.setQuitProposal(null)
    const what = kind === 'game' ? 'დანებებაზე' : 'ხელის დათმობაზე'
    if (reason === 'declined') {
      const voterName = refs.players.current.find(p => p.seat === voterSeat)?.name || 'ვიღაცამ'
      ctx.addToast(`${voterName}-მ უარი თქვა ${what} — თამაში გრძელდება.`, 'warning')
    } else {
      ctx.addToast(`${what} ხმის მიცემის დრო ამოიწურა — თამაში გრძელდება.`, 'warning')
    }
  })

  socket.on('error', ({ message, code, limit }) => {
    // If a play was in flight and got rejected, the client may have
    // optimistically removed a card — re-sync hand state from the server
    // so the player sees the correct deck again. Always release the lock.
    if (refs.playPending.current) {
      refs.playPending.current = false
      ctx.dispatch({ type: 'play-released' })
      socket.emit('request-state')
    }
    // Still in the lobby without a seat: a join was refused, so forget the
    // room code joinRoom stashed, or a later blip would rejoin it.
    if (refs.appPhase.current === 'lobby' && refs.publicSeat.current === null) refs.roomCode.current = ''
    // Re-watching after a blip failed (the game ended meanwhile): there is
    // nothing to go back to, so return to the lobby.
    if (refs.spectating.current && refs.reconnecting.current) {
      ctx.endReconnect({ flushChat: false })
      ctx.setSpectating(null)
      ctx.setRoom('')
      ctx.dispatch({ type: 'hand-cleared' })
      ctx.resetRoomScopedState()
      ctx.setAppPhase('lobby')
    }
    if (code === 'AUTH') {
      // Our profile session is gone (PIN changed, profile removed): the
      // lobby asks us to pick the profile again.
      dropProfileSession()
      ctx.addToast('აირჩიე პროფილი თავიდან.', 'error')
      return
    }
    if (code === 'CHAMPIONSHIP_LIMIT') {
      // The server's number, from the payload or its message.
      const max = Number(limit) || Number(/\((\d+)/.exec(message || '')?.[1]) || 8
      ctx.addToast(`დღის ლიმიტი ამოიწურა — ${max} ლიგის თამაში დღეში. აირჩიე კლასიკური თამაში.`, 'error')
      return
    }
    ctx.addToast(message, 'error')
  })
}
