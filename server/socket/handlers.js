'use strict';

const store = require('../db/store');
const { ownsSeat } = require('../game/GameManager');

const playerView = (p) => ({ id: p.id, name: p.name, avatar: p.avatar || null, seat: p.seat });
const playersView = (players = []) => players.map(playerView);

// ─── identity ───────────────────────────────────────────────────────────────
// Who a socket is playing as. With a profile session token (issued by the API
// when the lobby picks a profile, PIN checked) it is that profile: its current
// name and photo, and seats/entries are bound to its id. Without one, a typed
// name is accepted only if no PIN-protected profile uses it. `ownerKey` is the
// browser's own secret (handshake auth, see server/index.js), so a refresh can
// take its seat back but nobody else can.

const SESSION_CACHE_MS = 60 * 1000;
const sessionCache = new Map();   // token -> { profile, at }

function _identityError(message) {
  const err = new Error(message);
  err.code = 'AUTH';
  return err;
}

async function _profileForToken(token) {
  const hit = sessionCache.get(token);
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit.profile;
  const profile = await store.profileForSession(token);
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(token, { profile, at: Date.now() });
  return profile;
}

async function _identify(socket, { profileToken, playerName } = {}) {
  const ownerKey = socket.data.ownerKey || null;
  if (typeof profileToken === 'string' && profileToken) {
    const profile = await _profileForToken(profileToken);
    if (!profile) throw _identityError('Pick your profile again.');
    return { name: profile.name, avatar: profile.avatar, profileId: profile.id, ownerKey };
  }
  const name = typeof playerName === 'string' ? playerName.trim().slice(0, 64) : '';
  if (!name) throw new Error('playerName is required.');
  // A database outage shouldn't stop play — the name just isn't checked then.
  const profile = await store.getProfileByName(name).catch(() => null);
  if (profile?.has_pin) throw _identityError('That profile has a PIN — pick it in the lobby.');
  return { name: profile?.name || name, avatar: profile?.avatar || null, profileId: null, ownerKey };
}

/**
 * True when `playerName` has exhausted today's championship quota. Fails
 * open (returns false) if the DB is unreachable — a broken database should
 * degrade to "can't record games", not "can't play at all".
 */
async function _championshipBlocked(playerName) {
  try {
    const quota = await store.getChampionshipQuota(playerName);
    return quota.remaining <= 0;
  } catch (err) {
    console.warn(`[handlers] championship quota check failed for ${playerName}: ${err.message}`);
    return false;
  }
}

// ─── allowed reaction-sound ids ─────────────────────────────────────────────
// The catalogue lives in the `sounds` table (managed from /admin) and only
// changes when an admin adds or removes a clip, so it's cached rather than
// queried on every button press. `play-sound` fires several times a minute
// at a busy table; a DB round-trip per press would be silly.
//
// The seed list below is the pre-database catalogue. It's the fallback for
// two cases: the cache hasn't warmed yet (first press after boot), and the
// DB is unreachable — a database blip should mute nothing.
const SEED_SOUND_IDS = [
  'yeehaw', 'gunshot', 'whistle',
  'giv', 'janmrteloba', 'sheilage', 'shemetxara', 'tsava',
  'Dedofali', 'Male!', 'Revia', 'Tazik',
  '10-10', 'achexet', 'bedi', 'cxado', 'ketika',
];

const SOUND_CACHE_TTL_MS = 60 * 1000;
let soundIdCache = null;
let soundCacheAt = 0;
let soundCacheInFlight = null;

/** Cached set of valid ids. Refreshes in the background; never blocks. */
function allowedSoundIds() {
  const stale = Date.now() - soundCacheAt > SOUND_CACHE_TTL_MS;
  if (stale && !soundCacheInFlight) {
    soundCacheInFlight = store.listSoundIds()
      .then((ids) => {
        // An empty table means the seed migration hasn't run — keep the
        // fallback rather than silencing every button.
        if (ids.length) soundIdCache = new Set(ids);
        soundCacheAt = Date.now();
      })
      .catch((err) => {
        console.warn(`[handlers] sound catalogue refresh failed: ${err.message}`);
        // Back off for a full TTL instead of hammering a downed DB.
        soundCacheAt = Date.now();
      })
      .finally(() => { soundCacheInFlight = null; });
  }
  return soundIdCache || new Set(SEED_SOUND_IDS);
}

/**
 * Who is talking, and where.
 *
 * Chat, voice and sound all used to resolve the sender purely through
 * `socketRoomMap` → `room.players`. A tournament spectator is deliberately in
 * neither, so every one of those handlers silently dropped their messages.
 * Falling back to the spectator registry lets watchers join the conversation
 * without ever becoming a seat in the game.
 *
 * Returns null for a socket that is neither playing nor watching.
 */
function _resolveSpeaker(gameManager, socketId) {
  // Watching is checked FIRST, and the order matters. A spectator is almost
  // always someone whose own table has already finished, and that finished
  // seat is still in socketRoomMap — so resolving the player mapping first
  // sent their messages to the dead table they came from instead of the one
  // they are actually watching. Spectating is the deliberate, current action;
  // the old seat is residue.
  const watcher = gameManager.getSpectator(socketId);
  if (watcher) {
    return {
      roomCode: watcher.roomCode,
      seat: null,               // no seat: the UI must not draw a table bubble
      name: watcher.name,
      avatar: watcher.avatar || null,
      spectator: true,
      // Voice clips and sound buttons are held back from strangers who
      // wandered in off the homepage — that is an audio channel into a game
      // they aren't playing, and there's no accountability behind it. Inside
      // a tournament every watcher is a fellow entrant, so they keep the full
      // set. Text and reactions are open to both.
      canSpeak: !!watcher.tournamentId,
    };
  }

  const mapping = gameManager.getMappingBySocketId(socketId);
  if (mapping) {
    const room = gameManager.getRoom(mapping.roomCode);
    const player = room?.players.find((p) => p.seat === mapping.seat);
    if (player) {
      return {
        roomCode: mapping.roomCode,
        seat: player.seat,
        name: player.name,
        avatar: player.avatar || null,
        spectator: false,
        canSpeak: true,
      };
    }
  }
  return null;
}

// Chat is relayed, never stored, so the server has no message table to point
// a reaction at. A monotonic counter paired with the timestamp gives every
// message a stable id that both ends agree on, which is all a reaction needs.
let _chatSeq = 0;
const _nextMessageId = () => `m${Date.now().toString(36)}${(_chatSeq++).toString(36)}`;

// `_finishGame` lives at module scope (it's shared by several handlers), so it
// can't reach registerHandlers' `tournamentManager` parameter. Stash it here
// when the first connection wires things up.
let tournamentManagerRef = null;

/**
 * Push a fresh homepage snapshot to everyone. Called whenever the set of
 * watchable tables changes — a game starting or ending — so the lobby list
 * doesn't sit there advertising a table that has already finished.
 */
function _refreshLobby(io, gameManager) {
  io.emit('online-players', gameManager.onlineView());
  io.emit('live-games', gameManager.watchableGames());
}

// The tap-back palette. Deliberately a small closed set — clients render
// exactly these, and anything else is dropped on arrival.
const REACTION_EMOJIS = new Set(['😂', '❤️', '😮', '👏', '🔥']);

const CHAMPIONSHIP_LIMIT_MESSAGE =
  `Daily championship limit reached (${store.CHAMPIONSHIP_DAILY_LIMIT} games per day). Play a public game instead.`;

function registerHandlers(io, socket, gameManager, tournamentManager) {
  const socketId = socket.id;

  // The tournament manager owns bracket logic but does no emitting of its own,
  // so hand it a broadcaster built from the helpers that live here. Wired once
  // per process, on the first connection.
  if (tournamentManager && !tournamentManager.broadcast) {
    tournamentManagerRef = tournamentManager;
    tournamentManager.attach(_makeTournamentBroadcaster(io, gameManager, tournamentManager));
  }

  // Warm the catalogue on connect. Without this the first `play-sound` of a
  // server's life is checked against the seed fallback (the refresh it
  // kicks off only lands afterwards), so a freshly-uploaded clip would be
  // silently dropped once. A connect always precedes a button press.
  allowedSoundIds();

  function emitError(message, code) { socket.emit('error', { message, code }); }
  const fail = (err) => emitError(err.message, err.code);

  // One table at a time per socket: a homepage seat and a tournament entry
  // would both point this socket's room mapping at different games, and one
  // of the two tables would stall.

  /** The waiting or running room this socket sits at, if any. */
  function _tableOf() {
    const mapping = gameManager.getMappingBySocketId(socketId);
    const room = mapping && gameManager.getRoom(mapping.roomCode);
    return room && (room.status === 'waiting' || room.status === 'playing') ? room : null;
  }

  /**
   * The tournament that may still seat this socket: any stage up to the end
   * of the semifinals (finalists are only known then), and the final for
   * the finalists.
   */
  function _tournamentOf() {
    const t = tournamentManager?.findBySocket(socketId);
    if (!t || t.status !== 'final') return t || null;
    const entry = t.players.find((p) => p.id === socketId);
    const final = gameManager.getRoom(t.finalRoomCode);
    return final && final.status === 'playing' && final.players.some((p) => ownsSeat(p, entry)) ? t : null;
  }

  /** Refuse a new table while the socket is in a tournament (its own tables excepted). */
  function _assertNoTournament(roomCode) {
    const t = _tournamentOf();
    if (t && !(roomCode && gameManager.getRoom(roomCode)?.tournamentId === t.id)) {
      throw new Error('You are in a tournament — leave it first.');
    }
  }

  /** Refuse a tournament while the socket sits at another table. */
  function _assertNoTable(tournamentId) {
    const room = _tableOf();
    if (room && !(tournamentId && room.tournamentId === tournamentId)) {
      throw new Error('You are at a table — leave it first.');
    }
  }
  function emitChampionshipLimit() { emitError(CHAMPIONSHIP_LIMIT_MESSAGE, 'CHAMPIONSHIP_LIMIT'); }

  // ─── create-room ─────────────────────────────────────────────────────────
  socket.on('create-room', async (payload = {}) => {
    try {
      const me = await _identify(socket, payload);
      _assertNoTournament();
      const roomMode = payload.mode === 'championship' ? 'championship' : 'public';
      if (roomMode === 'championship' && await _championshipBlocked(me.name)) {
        return emitChampionshipLimit();
      }
      const { roomCode, seat } = gameManager.createRoom(socketId, me, roomMode);
      socket.join(roomCode);
      const room = gameManager.getRoom(roomCode);
      socket.emit('room-created', { roomCode, seat, mode: roomMode });
      io.to(roomCode).emit('player-joined', {
        players: playersView(room.players),
        roomCode,
        mode: room.mode,
      });
    } catch (err) {
      fail(err);
    }
  });

  // ─── join-room ────────────────────────────────────────────────────────────
  socket.on('join-room', async (payload = {}) => {
    try {
      const { roomCode } = payload;
      if (!roomCode || typeof roomCode !== 'string') return emitError('roomCode is required.');
      const me = await _identify(socket, payload);

      const rc = roomCode.toUpperCase();
      // If the room isn't currently in memory (e.g. server restarted while the
      // game was live), look it up in the database and rehydrate before joining.
      // This is the rejoin recovery path.
      if (!gameManager.getRoom(rc)) {
        await gameManager.tryLoadFromDB(rc);
      }
      _assertNoTournament(rc);

      // Championship rooms enforce the daily quota on genuinely NEW sit-downs
      // only — a reconnect (same name already seated) must never be blocked,
      // or a mid-game wifi blip would lock a player out of their own table.
      const targetRoom = gameManager.getRoom(rc);
      // Tournament tables are championship-grade for the leaderboard but are
      // explicitly exempt from the daily allowance — entering a bracket must
      // never be refused because of, or count against, the 8-a-day cap.
      if (targetRoom && targetRoom.mode === 'championship' && !targetRoom.tournamentId) {
        if (!gameManager.isSeated(targetRoom, me) && await _championshipBlocked(me.name)) {
          return emitChampionshipLimit();
        }
      }

      const { seat, reconnected, status } = gameManager.joinRoom(rc, socketId, me);
      socket.join(rc);
      const joinedRoom = gameManager.getRoom(rc);
      const roomMode = joinedRoom?.mode || 'public';

      if (reconnected) {
        _emitReconnected(rc, seat, me);
        return;
      }

      socket.emit('room-joined', {
        roomCode: rc, seat, status, mode: roomMode,
      });
      const room = gameManager.getRoom(rc);
      io.to(rc).emit('player-joined', {
        players: playersView(room.players),
        roomCode: rc,
        mode: roomMode,
      });
    } catch (err) {
      fail(err);
    }
  });

  /**
   * Back in an existing seat (a reconnect). `room-joined` tells the client
   * which screen to land on; at a bracket table the tournament entry follows
   * the new socket too, or the final would be seated on the dead one.
   */
  function _emitReconnected(rc, seat, me) {
    const room = gameManager.getRoom(rc);
    if (!room) return;
    let tournamentTag = null;
    if (room.tournamentId && tournamentManager) {
      const t = tournamentManager.rebind(socketId, me);
      if (t) {
        socket.join(t.id);
        tournamentTag = { id: t.id, code: t.code, stage: room.tournamentStage, table: room.tournamentTable };
        socket.emit('tournament-state', tournamentManager.lobbyView(t));
        socket.emit('tournament-overview', tournamentManager.overview(t));
      }
    }
    socket.emit('room-joined', {
      roomCode: rc, seat, reconnected: true, status: room.status, mode: room.mode || 'public',
      startedAt: room.startedAt || null, tournament: tournamentTag,
    });
    const state = gameManager.getStateForPlayer(rc, seat);
    if (state) socket.emit('game-state', { ...state, players: playersView(room.players) });
    io.to(rc).emit('player-reconnected', { playerName: me.name, players: playersView(room.players) });
  }

  // ─── public quick-match room ──────────────────────────────────────────────

  // Lobby clients ask for the current public-table snapshot on connect.
  socket.on('public-room-info', () => {
    try {
      socket.emit('public-room', gameManager.publicRoomView());
    } catch (err) { /* no-op */ }
  });

  // Sit at one of the homepage quick-match tables ('public' by default,
  // 'championship' when requested). The sitter stays on the homepage — no
  // waiting-room redirect — until the 3rd seat fills, at which point the
  // game starts automatically for all three and the table's slot resets.
  socket.on('sit-public', async (payload = {}) => {
    try {
      const me = await _identify(socket, payload);
      _assertNoTournament();
      const tableMode = payload.mode === 'championship' ? 'championship' : 'public';
      // Quota applies to fresh sit-downs only; re-taking your own seat after
      // a refresh must always work.
      if (tableMode === 'championship') {
        const waitingRoom = gameManager.quickMatchRoom(tableMode);
        if (!gameManager.isSeated(waitingRoom, me) && await _championshipBlocked(me.name)) {
          return emitChampionshipLimit();
        }
      }
      const { roomCode, seat } = gameManager.sitPublic(
        socketId, me, _sanitizeEmoji(payload.emoji), tableMode
      );
      socket.join(roomCode);
      socket.emit('public-seated', { roomCode, seat, mode: tableMode });
      io.emit('public-room', gameManager.publicRoomView());

      const room = gameManager.getRoom(roomCode);
      if (room && room.status === 'waiting' && room.players.length === 3) {
        const gameState = gameManager.startGame(roomCode);
        io.to(roomCode).emit('game-started', {
          round: gameState.round,
          leaderSeat: gameState.leaderSeat,
          players: playersView(room.players),
          startedAt: room.startedAt || null,
        });
        _emitHandDealt(io, room, gameState, roomCode);
        _refreshLobby(io, gameManager);
        // Free the homepage seats for the next trio.
        gameManager.clearPublicRoom(roomCode);
        io.emit('public-room', gameManager.publicRoomView());
      }
    } catch (err) {
      fail(err);
    }
  });

  // Stand up from the public table (only valid while it's still waiting).
  socket.on('stand-public', () => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return;
      const { roomCode } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room || !room.isPublic || room.status !== 'waiting') return;
      gameManager.leaveRoom(socketId);
      socket.leave(roomCode);
      if (!gameManager.getRoom(roomCode)) gameManager.clearPublicRoom(roomCode);
      socket.emit('public-unseated');
      io.emit('public-room', gameManager.publicRoomView());
    } catch (err) { /* no-op */ }
  });

  // Pick/clear the reaction emoji shown above the seated profile.
  socket.on('set-public-emoji', ({ emoji } = {}) => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return;
      const room = gameManager.getRoom(mapping.roomCode);
      if (!room || !room.isPublic || room.status !== 'waiting') return;
      const player = room.players.find((p) => p.seat === mapping.seat);
      if (!player) return;
      player.emoji = _sanitizeEmoji(emoji);
      io.emit('public-room', gameManager.publicRoomView());
    } catch (err) { /* no-op */ }
  });

  // Refresh recovery: re-attach ONLY (never fresh-sit) to the seat the
  // client stashed when it sat down. If the game has started in the meantime
  // this falls through to the standard in-game reconnect flow.
  socket.on('rejoin-public', async (payload = {}) => {
    try {
      const rc = String(payload.roomCode || '').toUpperCase();
      const room = gameManager.getRoom(rc);
      const me = await _identify(socket, payload);
      if (!room || !gameManager.isSeated(room, me)) return socket.emit('public-rejoin-failed');
      const { seat, status } = gameManager.joinRoom(rc, socketId, me);
      socket.join(rc);
      if (status === 'waiting') {
        socket.emit('public-seated', { roomCode: rc, seat, mode: room.mode || 'public' });
        io.emit('public-room', gameManager.publicRoomView());
      } else {
        _emitReconnected(rc, seat, me);
      }
    } catch (err) {
      socket.emit('public-rejoin-failed');
    }
  });

  // ─── start-game ──────────────────────────────────────────────────────────
  socket.on('start-game', () => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return emitError('You are not in a room.');
      const { roomCode } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room) return emitError('Room not found.');
      if (mapping.seat !== 0) return emitError('Only the room creator can start the game.');
      const gameState = gameManager.startGame(roomCode);
      io.to(roomCode).emit('game-started', {
        round: gameState.round,
        leaderSeat: gameState.leaderSeat,
        players: playersView(room.players),
        startedAt: room.startedAt || null,
      });
      _emitHandDealt(io, room, gameState, roomCode);
      _refreshLobby(io, gameManager);
    } catch (err) {
      fail(err);
    }
  });

  // ─── select-game-type ─────────────────────────────────────────────────────
  socket.on('select-game-type', ({ typeCode } = {}) => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return emitError('You are not in a room.');
      const { roomCode, seat } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room || !room.gameState) return emitError('Game not found.');
      if (seat !== room.gameState.leaderSeat) return emitError('Only the leader can select the game type.');
      if (!typeCode) return emitError('typeCode is required.');
      const result = gameManager.handleSelectGameType(roomCode, seat, typeCode);
      if (!result.ok) return emitError(result.error);
      const gs = room.gameState;
      io.to(roomCode).emit('game-type-selected', {
        typeCode,
        leaderSeat: gs.leaderSeat,
        phase: gs.phase,
        usedTypes: { ...gs.usedTypes },
      });
      // Send updated hand to leader. For non-trump types the 2 center cards
      // have already been merged in; for Pluses (trump_selection phase) the
      // merge is deferred until selectTrump(), so the hand here is still 10.
      socket.emit('hand-updated', {
        hand: gs.hands[seat],
        lastCenterCards: gs.lastCenterCards,
      });

    } catch (err) {
      fail(err);
    }
  });

  // ─── select-trump (for Pluses only) ───────────────────────────────────────
  socket.on('select-trump', ({ suit } = {}) => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return emitError('You are not in a room.');
      const { roomCode, seat } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room || !room.gameState) return emitError('Game not found.');
      const result = room.gameState.selectTrump(seat, suit);
      if (!result.ok) return emitError(result.error);
      const gs = room.gameState;
      io.to(roomCode).emit('trump-selected', {
        trumpSuit: gs.trumpSuit,
        phase: gs.phase,
        leaderSeat: gs.leaderSeat,
      });
      // The 2 center cards have just been merged into the leader's hand —
      // send the updated hand + which cards came from center for highlighting.
      socket.emit('hand-updated', {
        hand: gs.hands[seat],
        lastCenterCards: gs.lastCenterCards,
      });
    } catch (err) {
      fail(err);
    }
  });

  // ─── discard-cards ────────────────────────────────────────────────────────
  socket.on('discard-cards', ({ cards } = {}) => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return emitError('You are not in a room.');
      const { roomCode, seat } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room || !room.gameState) return emitError('Game not found.');
      if (!Array.isArray(cards) || cards.length !== 2) return emitError('Must provide exactly 2 cards to discard.');
      const result = gameManager.handleDiscardCards(roomCode, seat, cards);
      if (!result.ok) return emitError(result.error);
      const gs = room.gameState;
      socket.emit('hand-updated', { hand: gs.hands[seat] });
      io.to(roomCode).emit('cards-discarded', {
        phase: gs.phase,
        currentTurn: gs.currentTurn,
        leaderSeat: gs.leaderSeat,
      });
    } catch (err) {
      fail(err);
    }
  });

  // ─── play-card ────────────────────────────────────────────────────────────
  socket.on('play-card', ({ card } = {}) => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return emitError('You are not in a room.');
      const { roomCode, seat } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room || !room.gameState) return emitError('Game not found.');
      if (!card || !card.rank || !card.suit) return emitError('Invalid card object.');
      const result = gameManager.handlePlayCard(roomCode, seat, card);
      if (!result.ok) return emitError(result.error);
      const gs = room.gameState;

      if (!result.trickComplete) {
        const cardCounts = {};
        for (let s = 0; s < 3; s++) cardCounts[s] = gs.hands[s].length;
        io.to(roomCode).emit('card-played', {
          seat, card,
          currentTrick: gs.currentTrick,
          currentTurn: gs.currentTurn,
          ledSuit: gs.ledSuit,
          cardCounts,
        });
        return;
      }

      const cardCounts = {};
      for (let s = 0; s < 3; s++) cardCounts[s] = gs.hands[s].length;

      if (!result.roundEnds) {
        io.to(roomCode).emit('trick-complete', {
          winnerSeat: result.winnerSeat,
          trick: result.trick,
          roundEnds: false,
          trickNumber: gs.trickNumber,
          nextTurn: gs.currentTurn,
          tricksTaken: { ...gs.tricksTaken },
          cardCounts,
        });
        return;
      }

      // Round complete — a pending quit/surrender vote is moot now; drop it
      // so voters' dialogs don't linger into the next round.
      _clearQuitProposal(room);
      const lastDetail = gs.roundDetails[gs.roundDetails.length - 1];
      io.to(roomCode).emit('round-complete', {
        winnerSeat: result.winnerSeat,
        trick: result.trick,
        roundEnds: true,
        scores: result.scores,
        cumulativeScores: result.cumulativeScores,
        round: result.round,
        gameType: result.gameType,
        isGameOver: result.isGameOver,
        cardCounts,
        roundDetail: lastDetail,
      });
      if (result.isGameOver) {
        _finishGame(io, room, roomCode, gameManager);
      }
    } catch (err) {
      fail(err);
    }
  });

  // ─── next-round ───────────────────────────────────────────────────────────
  socket.on('next-round', () => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return emitError('You are not in a room.');
      const { roomCode } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room) return emitError('Room not found.');
      const gameState = gameManager.handleNextRound(roomCode, socketId);
      _clearQuitProposal(room);
      io.to(roomCode).emit('round-started', {
        round: gameState.round,
        leaderSeat: gameState.leaderSeat,
        phase: gameState.phase,
        usedTypes: { ...gameState.usedTypes },
      });
      _emitHandDealt(io, room, gameState, roomCode);
    } catch (err) {
      fail(err);
    }
  });

  // ─── play-sound ───────────────────────────────────────────────────────────
  // The player who emits this is "playing a sound at" `targetSeat` (which is
  // typically themselves). All players in the room receive the broadcast and
  // play the clip matching `soundId`. Server only validates the id against
  // the `sounds` catalogue (see allowedSoundIds).
  socket.on('play-sound', ({ soundId, targetSeat } = {}) => {
    try {
      if (!allowedSoundIds().has(soundId)) return;
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who || !who.canSpeak) return;
      // A spectator has no avatar on the felt, so a sound they fire has to
      // name the seat it pops over explicitly; without one there's nowhere to
      // draw the bubble and it's dropped.
      const target = typeof targetSeat === 'number' ? targetSeat : who.seat;
      if (target === null || target === undefined) return;
      io.to(who.roomCode).emit('play-sound', {
        soundId,
        bySeat: who.seat,
        spectator: who.spectator,
        targetSeat: target,
        at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── propose-quit ─────────────────────────────────────────────────────────
  // A player asks to end the current round early (`kind: 'round'`) or to
  // surrender the whole game (`kind: 'game'`). Both other players must accept
  // via `vote-quit` before anything happens; a single decline (or the 30s
  // expiry) kills the proposal and play continues untouched.
  socket.on('propose-quit', ({ kind } = {}) => {
    try {
      if (kind !== 'round' && kind !== 'game') return emitError('Invalid proposal.');
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return emitError('You are not in a room.');
      const { roomCode, seat } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room || !room.gameState) return emitError('Game not found.');
      if (room.status !== 'playing') return emitError('Game is not in progress.');
      const gs = room.gameState;
      if (kind === 'round' && !(gs.chosenGameType && (gs.phase === 'discard' || gs.phase === 'playing'))) {
        return emitError('The round cannot be quit right now.');
      }
      if (room.quitProposal) return emitError('Another proposal is already waiting on votes.');

      const player = room.players.find((p) => p.seat === seat);
      const proposal = {
        kind,
        proposerSeat: seat,
        accepted: new Set([seat]),
        timer: setTimeout(() => {
          if (room.quitProposal !== proposal) return;
          room.quitProposal = null;
          io.to(roomCode).emit('quit-rejected', { kind, proposerSeat: seat, reason: 'timeout' });
        }, QUIT_VOTE_MS),
      };
      if (typeof proposal.timer.unref === 'function') proposal.timer.unref();
      room.quitProposal = proposal;

      io.to(roomCode).emit('quit-proposal', {
        kind,
        proposerSeat: seat,
        proposerName: player ? player.name : `Player ${seat}`,
        acceptedSeats: [seat],
      });
    } catch (err) {
      fail(err);
    }
  });

  // ─── vote-quit ────────────────────────────────────────────────────────────
  socket.on('vote-quit', ({ accept } = {}) => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return emitError('You are not in a room.');
      const { roomCode, seat } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room || !room.gameState) return emitError('Game not found.');
      const proposal = room.quitProposal;
      if (!proposal) return emitError('No proposal is waiting on votes.');
      if (seat === proposal.proposerSeat) return emitError('You proposed this — the other players must vote.');
      const { kind, proposerSeat } = proposal;
      const proposerName =
        room.players.find((p) => p.seat === proposerSeat)?.name || `Player ${proposerSeat}`;

      if (!accept) {
        _clearQuitProposal(room);
        io.to(roomCode).emit('quit-rejected', { kind, proposerSeat, voterSeat: seat, reason: 'declined' });
        return;
      }

      proposal.accepted.add(seat);
      if (proposal.accepted.size < 3) {
        // One yes in, one to go — rebroadcast so everyone's UI updates.
        io.to(roomCode).emit('quit-proposal', {
          kind,
          proposerSeat,
          proposerName,
          acceptedSeats: [...proposal.accepted].sort((a, b) => a - b),
        });
        return;
      }

      // Unanimous — execute.
      _clearQuitProposal(room);
      const gs = room.gameState;

      if (kind === 'game') {
        _finishGame(io, room, roomCode, gameManager, { surrenderedBySeat: proposerSeat });
        return;
      }

      const result = gameManager.handleQuitRound(roomCode, proposerSeat);
      if (!result.ok) {
        // The round moved on while votes were coming in (e.g. it ended
        // naturally) — tell everyone the proposal fizzled.
        io.to(roomCode).emit('quit-rejected', { kind, proposerSeat, reason: 'timeout' });
        return;
      }
      const cardCounts = {};
      for (let s = 0; s < 3; s++) cardCounts[s] = gs.hands[s].length;
      const lastDetail = gs.roundDetails[gs.roundDetails.length - 1];
      io.to(roomCode).emit('round-complete', {
        winnerSeat: null,
        trick: null,
        roundEnds: true,
        scores: result.scores,
        cumulativeScores: result.cumulativeScores,
        round: result.round,
        gameType: result.gameType,
        isGameOver: result.isGameOver,
        cardCounts,
        roundDetail: lastDetail,
        quitBySeat: proposerSeat,
      });
      if (result.isGameOver) {
        _finishGame(io, room, roomCode, gameManager);
      }
    } catch (err) {
      fail(err);
    }
  });

  // ─── chat-typing ──────────────────────────────────────────────────────────
  // Lightweight presence ping: relayed to everyone else in the room so their
  // chat drawer / table avatars can show a "typing…" indicator. The client
  // throttles emission and expires the indicator on its own timer, so the
  // server just forwards.
  socket.on('chat-typing', () => {
    try {
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who) return;
      socket.to(who.roomCode).emit('chat-typing', {
        seat: who.seat, spectator: who.spectator, at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── voice-message ────────────────────────────────────────────────────────
  // Ephemeral voice clips: the binary payload is relayed as-is to everyone
  // in the sender's room and never stored — only players connected at that
  // moment hear it (a refresh loses history, same as chat bubbles).
  // Size-capped and lightly rate-limited so the pipe can't be flooded.
  let lastVoiceAt = 0;
  socket.on('voice-message', ({ audio, mime, duration } = {}) => {
    try {
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who || !who.canSpeak) return;
      if (!audio) return;
      const size = audio.byteLength ?? audio.length ?? 0;
      if (!size || size > MAX_VOICE_BYTES) return;
      const now = Date.now();
      if (now - lastVoiceAt < 800) return; // one clip per ~second per socket
      lastVoiceAt = now;
      io.to(who.roomCode).emit('voice-message', {
        id: _nextMessageId(),
        seat: who.seat,
        spectator: who.spectator,
        name: who.name,
        avatar: who.avatar,
        audio,
        mime: typeof mime === 'string' ? mime.slice(0, 64) : 'audio/webm',
        duration: Math.min(Math.max(Number(duration) || 0, 0), 30),
        at: now,
      });
    } catch (err) { /* no-op */ }
  });

  // ─── chat-message ─────────────────────────────────────────────────────────
  socket.on('chat-message', ({ message } = {}) => {
    try {
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who) return;
      if (typeof message !== 'string') return;
      const trimmed = message.trim().slice(0, 240);
      if (!trimmed) return;
      io.to(who.roomCode).emit('chat-message', {
        id: _nextMessageId(),
        seat: who.seat,
        spectator: who.spectator,
        name: who.name,
        avatar: who.avatar,
        message: trimmed,
        at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── chat-react ───────────────────────────────────────────────────────────
  // Tap-back on a chat message. Relayed, not stored: chat history itself is a
  // 50-message in-memory window that a refresh clears, so persisting the
  // reactions would outlive the messages they belong to. The server doesn't
  // know which ids are real either — it just fans out to the room and lets
  // each client match the id against what it is holding.
  //
  // `emoji` is checked against a fixed set rather than sanitised: an open
  // string here would be a second, unrate-limited chat channel.
  socket.on('chat-react', ({ messageId, emoji } = {}) => {
    try {
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who) return;
      if (typeof messageId !== 'string' || !messageId || messageId.length > 40) return;
      if (!REACTION_EMOJIS.has(emoji)) return;
      io.to(who.roomCode).emit('chat-reaction', {
        messageId,
        emoji,
        seat: who.seat,
        name: who.name,
        spectator: who.spectator,
        at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── rematch ──────────────────────────────────────────────────────────────
  //
  // Triggered by the "Play Again" button on the game-over screen. The first
  // click creates a fresh room with the clicker as seat 0; every subsequent
  // click from the same finished room is forwarded into that same new room
  // via joinRoom(). All sockets still in the OLD room get a `rematch-status`
  // broadcast so non-joiners can render a "wants to play again" badge above
  // each joined seat's avatar — and so non-clickers see the new room code
  // and can hit Play Again themselves.
  socket.on('request-rematch', async () => {
    try {
      const oldMapping = gameManager.getMappingBySocketId(socketId);
      if (!oldMapping) return emitError('You are not in a room.');
      const oldRoomCode = oldMapping.roomCode;
      const oldRoom     = gameManager.getRoom(oldRoomCode);
      if (!oldRoom) return emitError('Room not found.');
      // The new room keeps the identity of the seat this socket holds.
      const seatRow = oldRoom.players.find((p) => p.seat === oldMapping.seat);
      if (!seatRow) return emitError('Player name unavailable.');
      const me = {
        name: seatRow.name, avatar: seatRow.avatar || null,
        profileId: seatRow.profileId || null, ownerKey: seatRow.ownerKey || socket.data.ownerKey || null,
      };

      // A tournament seat is not rematchable — the bracket decides what comes
      // next, and spawning a stray room here would strand the player outside
      // it while their real table waits.
      if (oldRoom.tournamentId) {
        return emitError('Tournament games cannot be replayed.');
      }
      // A championship rematch is a brand-new championship game — the one
      // that just finished already counts, so after a player's 2nd game of
      // the day this correctly refuses (they can still rematch publicly by
      // creating a room from the lobby).
      if (oldRoom.mode === 'championship' && await _championshipBlocked(me.name)) {
        return emitChampionshipLimit();
      }

      const result = gameManager.requestRematch(socketId, me);
      if (result.error) return emitError(result.error);

      const { newRoomCode, seat, joinedOldSeats } = result;
      // Pull the requester out of the old socket.io room so they don't
      // keep receiving its broadcasts while sitting in the new lobby.
      socket.leave(oldRoomCode);
      socket.join(newRoomCode);

      // Tell the requester their new seat — same shape as `room-joined`
      // so the client uses the existing handler to transition into the
      // waiting room UI without a new code path.
      socket.emit('room-joined', {
        roomCode: newRoomCode, seat, status: 'waiting',
      });

      // Send the new lobby's player list to the requester so the waiting
      // room is populated immediately (otherwise the first joiner sits
      // there alone with no UI cue until the next player joins).
      const newRoom = gameManager.getRoom(newRoomCode);
      if (newRoom) {
        io.to(newRoomCode).emit('player-joined', {
          players: playersView(newRoom.players),
          roomCode: newRoomCode,
        });
      }

      // Fan-out to every socket still in the old (finished) room so
      // their game-over UI can render the "wants to play again" badges
      // and surface the rematch room code.
      io.to(oldRoomCode).emit('rematch-status', {
        newRoomCode,
        joinedOldSeats,
      });
    } catch (err) {
      fail(err);
    }
  });

  // ─── request-state ────────────────────────────────────────────────────────
  // Background resync only — every caller is a watchdog (turn timeout, tab
  // regained focus, rejected play), never a user action. Nothing here is
  // worth a toast, and emitting one from the `error` handler's own retry
  // path could ping-pong, so every failure mode exits quietly.
  socket.on('request-state', () => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return;
      const { roomCode, seat } = mapping;
      const state = gameManager.getStateForPlayer(roomCode, seat);
      // No state yet is the normal condition for a seat in a waiting room —
      // the tab-visibility watchdog fires `request-state` for anyone with a
      // room code, so erroring here popped a "No game state available" toast
      // every time a player sitting at a public table switched tabs. Nothing
      // to sync, nothing to say.
      if (!state) return;
      // Include the room roster (with avatars) — GameState.players carries only
      // id/name/seat, so emitting raw `state` would blank every avatar on the
      // client each time the desync watchdog resyncs. Mirror the reconnect path.
      const room = gameManager.getRoom(roomCode);
      socket.emit('game-state', {
        ...state,
        players: room ? playersView(room.players) : state.players,
      });
    } catch (err) {
      fail(err);
    }
  });

  // ─── presence + public watching ───────────────────────────────────────────
  // Who's online, and which King tables a stranger can drop in on. Announced
  // by the client once it knows which profile it's acting as; the lobby is
  // otherwise invisible to the server because nobody there is in a room.

  function _broadcastLobby() {
    io.emit('online-players', gameManager.onlineView());
    io.emit('live-games', gameManager.watchableGames());
  }

  socket.on('announce-presence', async (payload = {}) => {
    try {
      const me = await _identify(socket, payload);
      gameManager.announcePresence(socketId, me.name);
      _broadcastLobby();
    } catch (err) { /* no-op */ }
  });

  socket.on('lobby-info', () => {
    try {
      socket.emit('online-players', gameManager.onlineView());
      socket.emit('live-games', gameManager.watchableGames());
    } catch (err) { /* no-op */ }
  });

  // Watch any live King table from the homepage. Same masked state and the
  // same socket-room join as tournament spectating — the difference is only
  // who is allowed in and what they may send once there (see canSpeak).
  socket.on('watch-game', async (payload = {}) => {
    try {
      const rc = String(payload.roomCode || '').toUpperCase();
      const me = await _identify(socket, payload);
      _assertNoTournament();
      _assertNoTable();
      const room = gameManager.getRoom(rc);
      if (!room) return emitError('That table is no longer available.');
      if (room.status !== 'playing' || !room.gameState) {
        return emitError('That game is not in progress.');
      }

      // Watching a table you're seated at would replace your own hand with a
      // masked state — the same trap the tournament path guards.
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (mapping && mapping.roomCode === rc) {
        return emitError('You are playing at that table.');
      }
      if (gameManager.isSeated(room, me)) {
        return emitError('You are seated at that table.');
      }

      const previous = gameManager.removeSpectator(socketId);
      if (previous && previous.roomCode !== rc) socket.leave(previous.roomCode);

      // No tournamentId: this is a public watcher, so canSpeak stays false.
      gameManager.addSpectator(socketId, rc, { name: me.name, avatar: me.avatar });
      socket.join(rc);

      socket.emit('spectate-started', {
        roomCode: rc,
        tournamentId: null,
        startedAt: room.startedAt || null,
        players: playersView(room.players),
        stage: room.tournamentStage || null,
        table: room.tournamentTable ?? null,
      });
      socket.emit('game-state', {
        ...room.gameState.getStateForSpectator(),
        players: playersView(room.players),
      });
      // Let the table know someone is watching, and refresh the lobby counts.
      io.to(rc).emit('watchers', { count: gameManager.spectatorCount(rc) });
      _broadcastLobby();
    } catch (err) { fail(err); }
  });

  socket.on('stop-watching', () => {
    try {
      const gone = gameManager.removeSpectator(socketId);
      if (gone) {
        socket.leave(gone.roomCode);
        io.to(gone.roomCode).emit('watchers', { count: gameManager.spectatorCount(gone.roomCode) });
      }
      socket.emit('spectate-stopped');
      _broadcastLobby();
    } catch (err) { /* no-op */ }
  });

  // ─── tournament ───────────────────────────────────────────────────────────
  // A tournament is a lobby that fills to exactly 6 or 9, splits at random
  // into 3-player King tables, and feeds three finalists into one last table.
  // Everyone entered also sits in a socket room named after the tournament id
  // so roster and bracket updates reach them wherever they are.
  function _tournamentSync(t) {
    if (!t) return;
    io.to(t.id).emit('tournament-state', tournamentManager.lobbyView(t));
    io.emit('tournament-list', tournamentManager.openTournaments()
      .map((x) => tournamentManager.lobbyView(x)));
  }

  socket.on('tournament-create', async (payload = {}) => {
    try {
      if (!tournamentManager) return emitError('Tournaments are unavailable.');
      const me = await _identify(socket, payload);
      _assertNoTable();
      const t = tournamentManager.create(socketId, me, payload.size);
      socket.join(t.id);
      socket.emit('tournament-joined', tournamentManager.lobbyView(t));
      _tournamentSync(t);
    } catch (err) { fail(err); }
  });

  // Entering a lobby, or coming back to an entry after a refresh or a socket
  // blip — in which case a player whose bracket is already running is seated
  // back at their live table.
  socket.on('tournament-join', async (payload = {}) => {
    try {
      if (!tournamentManager) return emitError('Tournaments are unavailable.');
      const me = await _identify(socket, payload);
      _assertNoTable(tournamentManager.findByCode(payload.code)?.id);
      const { tournament: t, rejoined } = tournamentManager.join(payload.code, socketId, me);
      socket.join(t.id);
      socket.emit('tournament-joined', tournamentManager.lobbyView(t));
      if (rejoined && t.status !== 'lobby') {
        socket.emit('tournament-overview', tournamentManager.overview(t));
        const rc = tournamentManager.liveRoomOf(t, me);
        if (rc && gameManager.getMappingBySocketId(socketId)?.roomCode !== rc) {
          const { seat } = gameManager.joinRoom(rc, socketId, me);
          socket.join(rc);
          _emitReconnected(rc, seat, me);
        }
        return;
      }
      _tournamentSync(t);
      // The draw happens the moment the last seat is taken.
      if (tournamentManager.isFull(t)) {
        tournamentManager.startSemifinal(t);
        _tournamentSync(t);
        io.to(t.id).emit('tournament-overview', tournamentManager.overview(t));
      }
    } catch (err) { fail(err); }
  });

  socket.on('tournament-leave', () => {
    try {
      if (!tournamentManager) return;
      const res = tournamentManager.leave(socketId);
      if (!res) return;
      socket.leave(res.tournament?.id || `t_${res.code}`);
      socket.emit('tournament-left');
      _tournamentSync(res.tournament);
      io.emit('tournament-list', tournamentManager.openTournaments()
        .map((x) => tournamentManager.lobbyView(x)));
    } catch (err) { /* no-op */ }
  });

  socket.on('tournament-list', () => {
    try {
      if (!tournamentManager) return;
      socket.emit('tournament-list', tournamentManager.openTournaments()
        .map((x) => tournamentManager.lobbyView(x)));
    } catch (err) { /* no-op */ }
  });

  // Live cross-table view — which round every table is on and the scores.
  socket.on('tournament-overview', () => {
    try {
      if (!tournamentManager) return;
      const mapping = gameManager.getMappingBySocketId(socketId);
      const t = tournamentManager.findBySocket(socketId)
        || (mapping ? tournamentManager.findByRoom(mapping.roomCode) : null);
      if (!t) return;
      socket.emit('tournament-overview', tournamentManager.overview(t));
    } catch (err) { /* no-op */ }
  });

  // Watch another table. Safe by construction: every hand-bearing emit in
  // this file is addressed to a specific player socket (`io.to(player.id)`),
  // never to the room, so joining the room channel exposes only the shared
  // action — cards played, tricks, scores. The one thing a watcher would
  // otherwise miss is the current state, and that goes through the masked
  // `getStateForSpectator()`.
  socket.on('tournament-spectate', async (payload = {}) => {
    try {
      if (!tournamentManager) return;
      const rc = String(payload.roomCode || '').toUpperCase();
      const me = await _identify(socket, payload);
      const room = gameManager.getRoom(rc);
      if (!room) return emitError('That table is no longer available.');

      const t = tournamentManager.findByRoom(rc);
      if (!t) return emitError('That table is not part of a tournament.');
      // Only people in this tournament may watch its tables.
      const entrant = t.players.find((p) => p.id === socketId || ownsSeat(p, me));
      if (!entrant) return emitError('Only players in this tournament can watch.');

      // Watching is for players whose own table is done. Two reasons to be
      // strict here: a masked state would overwrite the real one and hide
      // your own hand, and every play/quit event still resolves through
      // socketRoomMap — so a watcher with a live seat would be acting on one
      // table while looking at another.
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (mapping) {
        if (mapping.roomCode === rc) {
          return emitError('You are playing at that table.');
        }
        const own = gameManager.getRoom(mapping.roomCode);
        if (own && own.status !== 'finished') {
          return emitError('Finish your own game before watching another table.');
        }
      }

      const previous = gameManager.removeSpectator(socketId);
      if (previous && previous.roomCode !== rc) socket.leave(previous.roomCode);

      gameManager.addSpectator(socketId, rc, {
        tournamentId: t.id,
        name: entrant.name,
        avatar: entrant.avatar || null,
      });
      socket.join(rc);

      socket.emit('spectate-started', {
        roomCode: rc,
        tournamentId: t.id,
        startedAt: room.startedAt || null,
        players: playersView(room.players),
        stage: room.tournamentStage || null,
        table: room.tournamentTable ?? null,
      });
      if (room.gameState) {
        socket.emit('game-state', {
          ...room.gameState.getStateForSpectator(),
          players: playersView(room.players),
        });
      }
      io.to(rc).emit('watchers', { count: gameManager.spectatorCount(rc) });
    } catch (err) { fail(err); }
  });

  // ─── leave-room ───────────────────────────────────────────────────────────
  socket.on('leave-room', () => {
    try {
      const result = gameManager.leaveRoom(socketId);
      if (!result) return;
      const { roomCode, playerName, room } = result;
      socket.leave(roomCode);
      if (result.stayed) {
        // Left a running game: the seat stays for its owner (see leaveRoom).
        if (room.players.every((p) => !p.connected)) gameManager.armRoomGrace(roomCode);
        else io.to(roomCode).emit('player-disconnected', { playerName });
        return;
      }
      io.to(roomCode).emit('player-left', {
        playerName,
        players: (room.players || []).map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
      });
    } catch (err) { /* no-op */ }
  });

  socket.on('disconnect', () => {
    try {
      // Watchers hold no seat, so they just stop watching. Left behind, they'd
      // leak into spectatorCount and keep receiving nothing forever.
      const wasWatching = gameManager.removeSpectator(socketId);
      if (wasWatching) {
        io.to(wasWatching.roomCode).emit('watchers', {
          count: gameManager.spectatorCount(wasWatching.roomCode),
        });
      }
      gameManager.forgetPresence(socketId);
      io.emit('online-players', gameManager.onlineView());
      io.emit('live-games', gameManager.watchableGames());
      if (tournamentManager) tournamentManager.markDisconnected(socketId);

      const info = gameManager.markDisconnected(socketId);
      if (!info) return;
      const { roomCode, playerName, seat } = info;
      const room = gameManager.getRoom(roomCode);
      if (!room) return;

      // Public table still collecting players: hold the seat briefly so a
      // refresh survives, then sweep it so a ghost can't block the table.
      if (room.isPublic && room.status === 'waiting') {
        const t = setTimeout(() => {
          const r = gameManager.getRoom(roomCode);
          if (!r || r.status !== 'waiting') return;
          const player = r.players.find((p) => p.seat === seat);
          if (!player || player.connected) return; // they came back
          r.players = r.players.filter((p) => p !== player);
          if (r.players.length === 0) {
            gameManager.destroyRoom(roomCode);
            gameManager.clearPublicRoom(roomCode);
          }
          io.emit('public-room', gameManager.publicRoomView());
        }, PUBLIC_SEAT_GRACE_MS);
        if (typeof t.unref === 'function') t.unref();
        return;
      }
      // Everyone offline at once (server hot-reload, brief wifi outage, all
      // three tabs closed): keep the room in memory for a grace window so
      // any of them can reconnect transparently. The grace timer is
      // cancelled the moment the first player reattaches.
      if (room.players.every((p) => !p.connected)) {
        gameManager.armRoomGrace(roomCode);
        return;
      }
      io.to(roomCode).emit('player-disconnected', { playerName });
    } catch (err) { /* no-op */ }
  });
}

// How long a quit/surrender proposal waits for votes before auto-expiring.
const QUIT_VOTE_MS = 30 * 1000;

// Hard cap on a relayed voice clip (≈15s of Opus fits well under this).
const MAX_VOICE_BYTES = 400 * 1024;

// How long a disconnected player keeps their public-table seat before it's
// swept and offered to the next sitter (long enough to survive a refresh).
const PUBLIC_SEAT_GRACE_MS = 30 * 1000;

// Reaction emojis are client-chosen; the server just caps them to something
// emoji-sized so nothing longer sneaks into the broadcast.
function _sanitizeEmoji(emoji) {
  if (typeof emoji !== 'string') return null;
  const trimmed = emoji.trim();
  if (!trimmed || trimmed.length > 8) return null;
  return trimmed;
}

function _clearQuitProposal(room) {
  if (!room || !room.quitProposal) return;
  if (room.quitProposal.timer) clearTimeout(room.quitProposal.timer);
  room.quitProposal = null;
}

/**
 * Shared game-over path: rank the cumulative scores, broadcast `game-over`,
 * flip the room to finished, and arm the grace timer so the room survives
 * long enough for "Play Again" clicks. `extra` is merged into the payload
 * (e.g. `surrenderedBySeat` when the game ended via a surrender vote).
 * The room is intentionally NOT destroyed here — see the rematch flow.
 */
function _finishGame(io, room, roomCode, gameManager, extra = {}) {
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
  const mode = room.mode === 'championship' ? 'championship' : 'public';

  // The game server is the only writer of King Online results. The id is
  // derived from the room and the final scores, so a retry can't double-save.
  const scorePart = [0, 1, 2]
    .map((s) => finalScores[s] ?? 0)
    .join('.')
    .replace(/-/g, 'n');
  const gameId = `g_${roomCode}_${winner.seat}_${scorePart}`;
  _saveWithRetry(gameId, {
    id: gameId,
    players: room.players.map((p) => ({
      seat: p.seat, name: p.name, avatar: p.avatar || null,
      score: finalScores[p.seat] ?? 0,
    })),
    winner,
    winners,
    isChampionship: mode === 'championship',
    roundDetails: gs.roundDetails || [],
  });

  io.to(roomCode).emit('game-over', {
    finalScores,
    winner,
    winners,
    isTie,
    mode,
    players: playersView(room.players),
    roundDetails: gs.roundDetails,
    ...extra,
  });
  gs.phase = 'game_over';
  room.status = 'finished';

  // Send the watchers home. The table they came to see is done, and leaving
  // them attached would leave them showing as "watching" a finished game with
  // no way back to the lobby.
  for (const watcherId of gameManager.evictSpectators(roomCode)) {
    io.in(watcherId).socketsLeave(roomCode);
    io.to(watcherId).emit('spectate-stopped', { reason: 'game-over' });
  }
  _refreshLobby(io, gameManager);

  // A tagged table feeds the bracket: recording the last semifinal result is
  // what draws the finalists and opens the final.
  if (room.tournamentId && tournamentManagerRef) {
    try {
      tournamentManagerRef.reportResult(roomCode, {
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

function _saveWithRetry(gameId, record, attempt = 0) {
  store.saveFinishedGame(record).catch((err) => {
    if (attempt >= SAVE_RETRY_MS.length) {
      console.error(`[handlers] saving finished game ${gameId} failed for good: ${err.message}`);
      return;
    }
    console.warn(`[handlers] saving finished game ${gameId} failed (${err.message}) — retrying`);
    const t = setTimeout(() => _saveWithRetry(gameId, record, attempt + 1), SAVE_RETRY_MS[attempt]);
    if (typeof t.unref === 'function') t.unref();
  });
}

/**
 * The emitting half of the tournament manager.
 *
 * Starting a bracket table has to look exactly like a normal game start to the
 * client, so it reuses the same `room-joined` → `game-started` → `hand-dealt`
 * sequence the start-game handler emits. `reconnected: true` is what moves the
 * client straight onto the table instead of parking it in a waiting room —
 * the players never chose this room, so there is no lobby step for them.
 */
function _makeTournamentBroadcaster(io, gameManager, tournamentManager) {
  const overviewOf = (t) => tournamentManager.overview(t);

  return {
    startTable(t, roomCode, group, stage, index, gameState) {
      const room = gameManager.getRoom(roomCode);
      if (!room || !gameState) return;

      for (const p of room.players) {
        if (!p.id) continue;
        // A finalist's socket still sits in its semifinal room; leaving it
        // keeps that table's chat and roster events off the final.
        if (stage === 'final') {
          for (const tb of t.tables) io.in(p.id).socketsLeave(tb.roomCode);
        }
        // Join by socket id: every socket is implicitly in a room named after
        // itself, so this works without holding socket objects.
        io.in(p.id).socketsJoin(roomCode);
        io.to(p.id).emit('room-joined', {
          roomCode,
          seat: p.seat,
          reconnected: true,
          status: 'playing',
          mode: 'championship',
          startedAt: room.startedAt || null,
          tournament: { id: t.id, code: t.code, stage, table: index },
        });
      }

      io.to(roomCode).emit('game-started', {
        round: gameState.round,
        leaderSeat: gameState.leaderSeat,
        players: playersView(room.players),
        startedAt: room.startedAt || null,
      });
      _emitHandDealt(io, room, gameState, roomCode);
      _refreshLobby(io, gameManager);
      io.to(t.id).emit('tournament-overview', overviewOf(t));
    },

    overviewChanged(t) {
      io.to(t.id).emit('tournament-overview', overviewOf(t));
    },

    finalStarted(t, roomCode, finalists) {
      io.to(t.id).emit('tournament-final', {
        roomCode,
        finalists: finalists.map((f) => ({
          name: f.name, avatar: f.avatar || null,
          score: f.score, wildcard: !f.isWinner,
        })),
        standings: t.standings,
      });
      io.to(t.id).emit('tournament-overview', overviewOf(t));
    },

    tournamentComplete(t) {
      io.to(t.id).emit('tournament-complete', {
        code: t.code,
        winners: t.winners,
        standings: t.standings,
      });
      io.to(t.id).emit('tournament-overview', overviewOf(t));
    },
  };
}

function _emitHandDealt(io, room, gameState, roomCode) {
  const cardCounts = {};
  for (let s = 0; s < 3; s++) cardCounts[s] = gameState.hands[s].length;
  for (const player of room.players) {
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
    });
  }
}

module.exports = registerHandlers;
