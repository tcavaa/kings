'use strict';

// The broadcasts that start a game, deal a round, end a round and end the
// game — shared by the play handlers, the quick-match tables and the
// tournament broadcaster. `ctx` is the server's context (see handlers.js).

const store = require('../db/store');
const { normalizeMode } = require('../lib/util');
const { playersView } = require('./shared');
const { LOBBY } = require('./lobby');

/**
 * A game just started at `room`: everyone gets the table and their hand, and
 * the players leave the lobby channel (they don't show its lists) while the
 * lobby learns there's a new live table.
 */
function emitGameStart(ctx, room, gameState) {
  const { io } = ctx;
  io.to(room.code).emit('game-started', {
    round: gameState.round,
    leaderSeat: gameState.leaderSeat,
    players: playersView(room.players),
    startedAt: room.startedAt || null,
    version: gameState.version,
  });
  emitHandDealt(io, room, gameState);
  io.in(room.code).socketsLeave(LOBBY);
  ctx.lobby.refresh();
}

function emitHandDealt(io, room, gameState) {
  const cardCounts = gameState.cardCounts();
  for (const player of room.players) {
    if (!player.id || !player.connected) continue;
    const isLeader = player.seat === gameState.leaderSeat;
    io.to(player.id).emit('hand-dealt', {
      // Every round (including the 1st): players see their own hand right
      // away, and non-leaders see the 2 prikup cards while the leader is
      // choosing. Only the leader is kept blind to the prikup until it's
      // merged into their hand.
      hand: gameState.hands[player.seat],
      centerCards: isLeader ? [] : gameState.centerCards,
      leaderSeat: gameState.leaderSeat,
      round: gameState.round,
      cardCounts,
      version: gameState.version,
    });
  }
}

/** A round just ended (played out or quit): tell the table, and finish the game after round 27. */
function emitRoundComplete(ctx, room, result, extra) {
  const gs = room.gameState;
  ctx.io.to(room.code).emit('round-complete', {
    ...extra,
    roundEnds: true,
    scores: result.scores,
    cumulativeScores: result.cumulativeScores,
    round: result.round,
    gameType: result.gameType,
    isGameOver: result.isGameOver,
    cardCounts: gs.cardCounts(),
    roundDetail: gs.roundDetails[gs.roundDetails.length - 1],
    version: gs.version,
  });
  if (result.isGameOver) finishGame(ctx, room, room.code);
}

/**
 * Shared game-over path: rank the cumulative scores, broadcast `game-over`,
 * flip the room to finished, and arm the grace timer so the room survives
 * long enough for "Play Again" clicks. `extra` is merged into the payload
 * (e.g. `surrenderedBySeat` when the game ended via a surrender vote).
 * The room is intentionally NOT destroyed here — see the rematch flow.
 */
function finishGame(ctx, room, roomCode, extra = {}) {
  const { io, gameManager, tournamentManager } = ctx;
  const gs = room.gameState;

  const finalScores = { ...gs.cumulativeScores };
  let bestScore = null;
  for (let s = 0; s < 3; s++) {
    if (bestScore === null || finalScores[s] > bestScore) {
      bestScore = finalScores[s];
    }
  }
  // Everyone on the top score is a winner — a tie crowns them all. `winner`
  // (the lowest-seat one) is kept alongside `winners` for older consumers.
  const winners = [0, 1, 2]
    .filter((s) => finalScores[s] === bestScore)
    .map((s) => ({
      seat: s,
      name: room.players.find((p) => p.seat === s)?.name || 'Unknown',
      score: bestScore,
    }));
  const winner = winners[0];
  const isTie = winners.length > 1;
  const mode = normalizeMode(room.mode);

  // The game server is the only writer of King Online results. The id is
  // derived from the room and the final scores, so a retry can't double-save.
  // Until the save lands, the daily quota counts the game from memory (see
  // GameManager.championshipGamesInFlight).
  const scorePart = [0, 1, 2]
    .map((s) => finalScores[s] ?? 0)
    .join('.')
    .replace(/-/g, 'n');
  const gameId = `g_${roomCode}_${winner.seat}_${scorePart}`;
  room.saved = false;
  saveWithRetry(gameId, {
    id: gameId,
    players: room.players.map((p) => ({
      seat: p.seat, name: p.name, avatar: p.avatar || null,
      score: finalScores[p.seat] ?? 0,
    })),
    winner,
    winners,
    isChampionship: mode === 'championship',
    // Bracket tables are league games that don't use up the daily quota.
    tournamentId: room.tournamentId || null,
    tournamentStage: room.tournamentStage || null,
    roundDetails: gs.roundDetails || [],
  }).then((saved) => { if (saved) room.saved = true; });

  gs.finish();
  room.status = 'finished';
  io.to(roomCode).emit('game-over', {
    finalScores,
    winner,
    winners,
    isTie,
    mode,
    players: playersView(room.players),
    roundDetails: gs.roundDetails,
    version: gs.version,
    ...extra,
  });

  // Send the watchers home. The table they came to see is done, and leaving
  // them attached would leave them showing as "watching" a finished game with
  // no way back to the lobby.
  for (const watcherId of gameManager.evictSpectators(roomCode)) {
    io.in(watcherId).socketsLeave(roomCode);
    io.to(watcherId).emit('spectate-stopped', { reason: 'game-over' });
  }
  ctx.lobby.refresh();

  // A tagged table feeds the bracket: recording the last semifinal result is
  // what draws the finalists and opens the final.
  if (room.tournamentId && tournamentManager) {
    try {
      tournamentManager.reportResult(roomCode, {
        winners,
        finalScores,
        players: playersView(room.players),
        roundDetails: gs.roundDetails || [],
      });
    } catch (err) {
      console.warn(`[handlers] tournament report for ${roomCode} failed: ${err.message}`);
    }
  }

  gameManager.armRoomGrace(roomCode);
  // The result is in `finished_games` now — drop the live snapshot. The room
  // itself stays in memory for the rematch grace window.
  gameManager.retireRoom(roomCode);
}

const SAVE_RETRY_MS = [2000, 10000, 30000];

/** Save a finished game, retrying a failure. Resolves true once it's saved. */
function saveWithRetry(gameId, record, attempt = 0) {
  return store.saveFinishedGame(record).then(() => true, (err) => {
    if (attempt >= SAVE_RETRY_MS.length) {
      console.error(`[handlers] saving finished game ${gameId} failed for good: ${err.message}`);
      return false;
    }
    console.warn(`[handlers] saving finished game ${gameId} failed (${err.message}) — retrying`);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(saveWithRetry(gameId, record, attempt + 1)), SAVE_RETRY_MS[attempt]);
      if (typeof t.unref === 'function') t.unref();
    });
  });
}

module.exports = { emitGameStart, emitHandDealt, emitRoundComplete, finishGame };
