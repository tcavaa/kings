import { useEffect } from 'react'
import { io } from 'socket.io-client'
import { SOCKET_URL, getClientKey } from '../lib/api'
import { readSeatMarker } from '../lib/publicSeatStore'
import { registerRoomEvents } from './events/roomEvents'
import { registerTableEvents } from './events/tableEvents'
import { registerChatEvents } from './events/chatEvents'
import { registerLobbyEvents } from './events/lobbyEvents'

/**
 * The one socket to the game server, for the provider's lifetime: connect,
 * reconnect back into whatever we were doing, every event listener, and the
 * resync when a backgrounded tab comes back. `ctx` is the provider's toolbox
 * (refs, setters and helpers that never change identity).
 */
export function useGameSocket(ctx) {
  // `ctx` is built once and never changes identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => connectGameSocket(ctx), [])
}

/**
 * Open the socket and wire everything up; returns the teardown. Plain (no
 * hooks), so it can also be driven outside React.
 */
export function connectGameSocket(ctx, url = SOCKET_URL) {
  const { refs } = ctx
  // Use socket.io's default transport flow: connect via long-polling first
  // (which works on any HTTP server), then *optimistically* upgrade to
  // WebSocket in the background. If the host doesn't allow WS upgrades, we
  // silently stay on polling instead of hanging on the WS handshake. The
  // game server is its own host (see SOCKET_URL).
  //
  // Reconnection is socket.io's default — we just turn the knobs to be
  // a bit more aggressive on the first few attempts because mobile wifi
  // tends to come back within seconds.
  const socket = io(url, {
    // This browser's own secret: the server binds our seats to it, so a
    // refresh gets them back and nobody else can.
    auth: { clientKey: getClientKey() },
    withCredentials: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    // Generous: a sleeping Render instance takes up to ~30 s to boot, and a
    // shorter timeout aborted and restarted the handshake meanwhile. The
    // lobby says the server is waking up after a few seconds.
    timeout: 25000,
  })
  refs.socket.current = socket

  // Remember the table version of every game event (see ctx.requestState).
  socket.onAny((_event, payload) => {
    if (payload && typeof payload.version === 'number') {
      refs.stateVersion.current = { room: refs.roomCode.current, version: payload.version }
    }
  })

  socket.on('connect', () => {
    ctx.setConnected(true)
    // Always refresh the homepage public-table snapshot on (re)connect.
    socket.emit('public-room-info')
    // After a prior `disconnect`, socket.io has just (re)opened the pipe —
    // but the new socket id has no server-side mapping. Ask to be put back
    // where we were; the server answers with our seat (and a fresh
    // snapshot). Without this, the table looks frozen on the previous tick
    // and the user has to refresh.
    if (refs.hadDisconnect.current && (refs.roomCode.current || refs.tournamentCode.current)) {
      const roomCode = refs.roomCode.current
      const watching = refs.spectating.current
      if (watching) {
        // Watching, not seated: ask to watch the same table again
        // (spectate-started ends the reconnect).
        socket.emit(watching.tournamentId ? 'tournament-spectate' : 'watch-game', {
          roomCode, ...ctx.identity(),
        })
      } else if (refs.publicSeat.current !== null && roomCode) {
        // A homepage quick-match seat. `join-room` would land us in a
        // private-style WaitingRoom; rejoin-public keeps us on the homepage
        // (and falls through to the in-game reconnect if it has started).
        socket.emit('rejoin-public', { roomCode, ...ctx.identity() })
      } else if (roomCode) {
        socket.emit('join-room', { roomCode, ...ctx.identity() })
      }
      // The tournament keeps sending roster/bracket updates — and seats the
      // final — to whichever socket its entry points at.
      if (refs.tournamentCode.current) {
        socket.emit('tournament-join', { code: refs.tournamentCode.current, ...ctx.identity() })
      }
      // Stay in the "reconnecting…" state until the server acknowledges
      // (room-joined { reconnected }, public-seated, spectate-started, or
      // tournament-joined in a tournament lobby).
    } else {
      // Fresh connect (page load, no prior session). We may have a stored
      // quick-match seat, but taking it back automatically is exactly the
      // behaviour that made the homepage teleport returning visitors into
      // a game they'd walked away from. Surface it instead and let the
      // lobby offer a "rejoin" button.
      if (!refs.roomCode.current) ctx.setResumableSeat(readSeatMarker())
      ctx.setReconnecting(false)
    }
  })

  socket.on('disconnect', () => {
    ctx.setConnected(false)
    // Only flag the reconnect banner if we were actually mid-game / mid-
    // lobby — a brief blip during the very first connection attempt
    // shouldn't pop the banner.
    if (refs.roomCode.current || refs.tournamentCode.current) {
      refs.hadDisconnect.current = true
      ctx.setReconnecting(true)
    }
  })

  registerRoomEvents(socket, ctx)
  registerTableEvents(socket, ctx)
  registerChatEvents(socket, ctx)
  registerLobbyEvents(socket, ctx)

  // ── Visibility-resume safety net ──────────────────────────────────────
  // Mobile browsers throttle background tabs aggressively: setTimeout can
  // be coalesced to ≥1 Hz, Phaser's scene clock can stall, and socket.io
  // can lose its heartbeat without firing a visible disconnect. The net
  // effect was "I came back to the tab and a card the other player put
  // down ages ago is still missing from my screen". Whenever the tab
  // returns to `visible`, ask the server for the authoritative snapshot.
  // Cheap and idempotent — the `game-state` handler is built for replay.
  let lastResyncAt = 0
  const onResumeVisibility = () => {
    if (document.visibilityState !== 'visible') return
    if (!refs.roomCode.current) return            // not in a room — nothing to sync
    // Only a live table has a snapshot to resync. Sitting in a waiting
    // room (public quick-match seat, pre-start lobby) there is nothing on
    // the server to ask for, so the round-trip is pure noise.
    if (refs.appPhase.current !== 'game') return
    const now = Date.now()
    // Throttle: visibilitychange can fire in rapid bursts (focus + page
    // visibility events on iOS sometimes double-fire). One resync per
    // second is plenty.
    if (now - lastResyncAt < 1000) return
    lastResyncAt = now
    ctx.requestState()
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onResumeVisibility)
  }

  return () => {
    ctx.clearTrickTimers()
    ctx.clearGameOverTimer()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onResumeVisibility)
    }
    socket.disconnect()
  }
}
