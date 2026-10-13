'use strict';

// Playing a hand: the leader's decisions, cards, the next round, quit and
// surrender votes, and the resync a client asks for when it thinks it fell
// behind.

const { playersView } = require('./shared');
const { emitHandDealt, emitRoundComplete, finishGame } = require('./gameFlow');

// How long a quit/surrender proposal waits for votes before auto-expiring.
const QUIT_VOTE_MS = 30 * 1000;

// A player who has been disconnected this long no longer has to vote: the
// players still at the table can quit the round or end the game without them.
const GONE_MS = Number(process.env.QUIT_GONE_MS) || 20 * 1000;  // env: tests only

/** Seats that must agree to a quit/surrender: everyone not gone for good. */
function quitVoters(room) {
  const now = Date.now();
  return room.players
    .filter((p) => p.connected || !p.leftAt || now - p.leftAt < GONE_MS)
    .map((p) => p.seat);
}

function emitQuitProposal(io, room, roomCode) {
  const { kind, proposerSeat, accepted } = room.quitProposal;
  io.to(roomCode).emit('quit-proposal', {
    kind,
    proposerSeat,
    proposerName: room.players.find((p) => p.seat === proposerSeat)?.name || `Player ${proposerSeat}`,
    acceptedSeats: [...accepted].sort((a, b) => a - b),
    voters: quitVoters(room),
  });
}

/**
 * Carry out the pending quit/surrender once every player still present has
 * agreed. Ending the game this way makes the highest score the winner, the
 * same as a surrender. Returns true when it ran.
 */
function settleQuitProposal(ctx, room, roomCode) {
  const { io, gameManager } = ctx;
  const proposal = room.quitProposal;
  if (!proposal) return false;
  const voters = quitVoters(room);
  if (!voters.every((seat) => proposal.accepted.has(seat))) return false;
  const { kind, proposerSeat } = proposal;
  const goneSeats = room.players.map((p) => p.seat).filter((seat) => !voters.includes(seat));
  clearQuitProposal(room);

  if (kind === 'game') {
    finishGame(ctx, room, roomCode,
      goneSeats.length ? { abandonedSeats: goneSeats } : { surrenderedBySeat: proposerSeat });
    return true;
  }

  const result = gameManager.handleQuitRound(roomCode, proposerSeat);
  if (!result.ok) {
    // The round moved on while votes were coming in (e.g. it ended
    // naturally) — tell everyone the proposal fizzled.
    io.to(roomCode).emit('quit-rejected', { kind, proposerSeat, reason: 'timeout' });
    return true;
  }
  emitRoundComplete(ctx, room, result, { winnerSeat: null, trick: null, quitBySeat: proposerSeat });
  return true;
}

function clearQuitProposal(room) {
  if (!room || !room.quitProposal) return;
  if (room.quitProposal.timer) clearTimeout(room.quitProposal.timer);
  room.quitProposal = null;
}

function register(io, socket, ctx, conn) {
  const { gameManager } = ctx;
  const { socketId, emitError, withSeat } = conn;

  // The decision phases below ignore a repeated tap once the phase has moved
  // on (a double tap, or a tap that crossed the server's answer): there is
  // nothing to tell the player that their screen won't show anyway.

  // ─── select-game-type ─────────────────────────────────────────────────────
  socket.on('select-game-type', withSeat(({ roomCode, seat, gs }, { typeCode }) => {
    if (gs.phase !== 'type_selection') return;
    if (seat !== gs.leaderSeat) return emitError('Only the leader can select the game type.');
    if (!typeCode) return emitError('typeCode is required.');
    const result = gameManager.handleSelectGameType(roomCode, seat, typeCode);
    if (!result.ok) return emitError(result.error);
    io.to(roomCode).emit('game-type-selected', {
      typeCode,
      leaderSeat: gs.leaderSeat,
      phase: gs.phase,
      usedTypes: { ...gs.usedTypes },
      version: gs.version,
    });
    // Send updated hand to leader. For non-trump types the 2 center cards
    // have already been merged in; for Pluses (trump_selection phase) the
    // merge is deferred until selectTrump(), so the hand here is still 10.
    socket.emit('hand-updated', {
      hand: gs.hands[seat],
      lastCenterCards: gs.lastCenterCards,
    });
  }));

  // ─── select-trump (for Pluses only) ───────────────────────────────────────
  socket.on('select-trump', withSeat(({ roomCode, seat, gs }, { suit }) => {
    if (gs.phase !== 'trump_selection') return;
    const result = gameManager.handleSelectTrump(roomCode, seat, suit);
    if (!result.ok) return emitError(result.error);
    io.to(roomCode).emit('trump-selected', {
      trumpSuit: gs.trumpSuit,
      phase: gs.phase,
      leaderSeat: gs.leaderSeat,
      version: gs.version,
    });
    // The 2 center cards have just been merged into the leader's hand —
    // send the updated hand + which cards came from center for highlighting.
    socket.emit('hand-updated', {
      hand: gs.hands[seat],
      lastCenterCards: gs.lastCenterCards,
    });
  }));

  // ─── discard-cards ────────────────────────────────────────────────────────
  socket.on('discard-cards', withSeat(({ roomCode, seat, gs }, { cards }) => {
    if (gs.phase !== 'discard') return;
    if (!Array.isArray(cards) || cards.length !== 2) return emitError('Must provide exactly 2 cards to discard.');
    const result = gameManager.handleDiscardCards(roomCode, seat, cards);
    if (!result.ok) return emitError(result.error);
    socket.emit('hand-updated', { hand: gs.hands[seat] });
    io.to(roomCode).emit('cards-discarded', {
      phase: gs.phase,
      currentTurn: gs.currentTurn,
      leaderSeat: gs.leaderSeat,
      version: gs.version,
    });
  }));

  // ─── play-card ────────────────────────────────────────────────────────────
  socket.on('play-card', withSeat(({ roomCode, seat, room, gs }, { card }) => {
    const result = gameManager.handlePlayCard(roomCode, seat, card);
    if (!result.ok) return emitError(result.error);
    const cardCounts = gs.cardCounts();

    if (!result.trickComplete) {
      io.to(roomCode).emit('card-played', {
        seat,
        card: result.card,
        currentTrick: gs.currentTrick,
        currentTurn: gs.currentTurn,
        ledSuit: gs.ledSuit,
        cardCounts,
        version: gs.version,
      });
      return;
    }

    if (!result.roundEnds) {
      io.to(roomCode).emit('trick-complete', {
        winnerSeat: result.winnerSeat,
        trick: result.trick,
        roundEnds: false,
        trickNumber: gs.trickNumber,
        nextTurn: gs.currentTurn,
        tricksTaken: { ...gs.tricksTaken },
        cardCounts,
        version: gs.version,
      });
      return;
    }

    // Round complete — a pending quit/surrender vote is moot now; drop it
    // so voters' dialogs don't linger into the next round.
    clearQuitProposal(room);
    emitRoundComplete(ctx, room, result, { winnerSeat: result.winnerSeat, trick: result.trick });
  }));

  // ─── next-round ───────────────────────────────────────────────────────────
  socket.on('next-round', withSeat(({ roomCode, room, gs }) => {
    if (gs.phase !== 'round_end') return;
    const gameState = gameManager.handleNextRound(roomCode, socketId);
    clearQuitProposal(room);
    io.to(roomCode).emit('round-started', {
      round: gameState.round,
      leaderSeat: gameState.leaderSeat,
      phase: gameState.phase,
      usedTypes: { ...gameState.usedTypes },
      // Watchers get no `hand-dealt`, so the fresh card counts come here.
      cardCounts: gameState.cardCounts(),
      version: gameState.version,
    });
    emitHandDealt(io, room, gameState);
  }));

  // ─── propose-quit ─────────────────────────────────────────────────────────
  // A player asks to end the current round early (`kind: 'round'`) or to
  // surrender the whole game (`kind: 'game'`). Both other players must accept
  // via `vote-quit` before anything happens; a single decline (or the 30s
  // expiry) kills the proposal and play continues untouched.
  socket.on('propose-quit', (payload = {}) => {
    const { kind } = payload || {};
    if (kind !== 'round' && kind !== 'game') return emitError('Invalid proposal.');
    withSeat(({ roomCode, seat, room, gs }) => {
      if (room.status !== 'playing') return emitError('Game is not in progress.');
      if (kind === 'round' && !(gs.chosenGameType && (gs.phase === 'discard' || gs.phase === 'playing'))) {
        return emitError('The round cannot be quit right now.');
      }
      if (room.quitProposal) return emitError('Another proposal is already waiting on votes.');

      const proposal = {
        kind,
        proposerSeat: seat,
        accepted: new Set([seat]),
        timer: setTimeout(() => {
          if (room.quitProposal !== proposal) return;
          // Someone who was only briefly away may have counted as present
          // when the vote opened and be gone by now.
          if (settleQuitProposal(ctx, room, roomCode)) return;
          room.quitProposal = null;
          io.to(roomCode).emit('quit-rejected', { kind, proposerSeat: seat, reason: 'timeout' });
        }, QUIT_VOTE_MS),
      };
      if (typeof proposal.timer.unref === 'function') proposal.timer.unref();
      room.quitProposal = proposal;

      if (!settleQuitProposal(ctx, room, roomCode)) emitQuitProposal(io, room, roomCode);
    })(payload);
  });

  // ─── vote-quit ────────────────────────────────────────────────────────────
  socket.on('vote-quit', withSeat(({ roomCode, seat, room }, { accept }) => {
    const proposal = room.quitProposal;
    if (!proposal) return emitError('No proposal is waiting on votes.');
    if (seat === proposal.proposerSeat) return emitError('You proposed this — the other players must vote.');
    const { kind, proposerSeat } = proposal;

    if (!accept) {
      clearQuitProposal(room);
      io.to(roomCode).emit('quit-rejected', { kind, proposerSeat, voterSeat: seat, reason: 'declined' });
      return;
    }

    proposal.accepted.add(seat);
    // Not everyone present has agreed yet — rebroadcast so every UI updates.
    if (!settleQuitProposal(ctx, room, roomCode)) emitQuitProposal(io, room, roomCode);
  }));

  // ─── request-state ────────────────────────────────────────────────────────
  // Background resync only — every caller is a watchdog (turn timeout, tab
  // regained focus, rejected play), never a user action. Nothing here is
  // worth a toast, and emitting one from the `error` handler's own retry
  // path could ping-pong, so every failure mode exits quietly.
  //
  // A client that sends the `version` of the state it holds (every game event
  // carries one) gets a short `state-current` when nothing has changed,
  // instead of the whole table.
  socket.on('request-state', (payload) => {
    try {
      const known = payload && Number.isInteger(payload.version) ? payload.version : null;
      // A watcher has no seat: answer with the masked view of the table they
      // watch. Checked first — a watcher's old, finished seat may still map.
      const watching = gameManager.getSpectator(socketId);
      const mapping = watching ? null : gameManager.getMappingBySocketId(socketId);
      const room = gameManager.getRoom(watching ? watching.roomCode : mapping?.roomCode);
      // No state yet is the normal condition for a seat in a waiting room —
      // the tab-visibility watchdog fires `request-state` for anyone with a
      // room code. Nothing to sync, nothing to say.
      if (!room || !room.gameState) return;
      const gs = room.gameState;
      if (known === gs.version) return socket.emit('state-current', { version: gs.version });
      const state = watching ? gs.getStateForSpectator() : gs.getStateForPlayer(mapping.seat);
      // Include the room roster (with avatars) — the game state carries none.
      socket.emit('game-state', { ...state, players: playersView(room.players) });
    } catch (err) { /* no-op */ }
  });
}

module.exports = { register };
