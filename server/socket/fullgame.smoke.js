'use strict';

// A complete 27-round King game over real sockets: three bots create a
// championship room, play every round to the end (type selection, trump,
// discards, all tricks, next-round), and the finished game must land in
// finished_games. Math.random is seeded, and the bots always pick the first
// legal move, so a given SEED produces exactly the same game every run — on
// this server or on any other build of it (SERVER_DIR), which makes the
// printed digest a cross-version equivalence check.
//
// Run: PORT=3530 SEED=7 node socket/fullgame.smoke.js
//      SERVER_DIR=/path/to/other/server PORT=3531 SEED=7 node socket/fullgame.smoke.js

const path = require('path');
const crypto = require('crypto');

// ── deterministic Math.random (mulberry32) — installed before the server loads.
// Only the game's own code (room codes, shuffles) draws from the seeded
// stream; anything else (database drivers jitter their connection lifetimes
// with Math.random) gets the real one, so a driver can't shift the deal.
let seed = Number(process.env.SEED || 7) >>> 0;
const seeded = () => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const nativeRandom = Math.random;
Math.random = function random() {
  const caller = (new Error().stack || '').split('\n')[2] || '';
  return /[\\/](game|tournament)[\\/][^\\/]+\.js/.test(caller) && !caller.includes('node_modules')
    ? seeded()
    : nativeRandom();
};

process.env.PORT = process.env.PORT || '3530';
const SERVER_DIR = path.resolve(process.env.SERVER_DIR || path.join(__dirname, '..'));
require(path.join(SERVER_DIR, 'index.js'));
const store = require(path.join(SERVER_DIR, 'db', 'store.js'));
const GameState = require(path.join(SERVER_DIR, 'game', 'GameState.js'));
const { io } = require('socket.io-client');

const URL = `http://localhost:${process.env.PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.error('FAIL  ' + n + ' ' + e); } };

const TYPE_ORDER = ['K', 'Q', 'J', 'H', 'L2', 'T', 'P1', 'P2', 'P3'];
const RANK_ORDER = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_ORDER = ['C', 'D', 'H', 'S'];
const byCard = (a, b) => (SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit))
  || (RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
const same = (a, b) => a.rank === b.rank && a.suit === b.suit;

function canDiscard(type, c) {
  if (type === 'K' || type === 'H') return c.suit !== 'H';
  if (type === 'Q') return c.rank !== 'Q';
  if (type === 'J') return c.rank !== 'J';
  return true;
}

function bot(name) {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    const b = { s, name, seat: null, room: null, over: null, errors: [], lastKey: null, rounds: 0 };
    s.on('room-created', (p) => { b.room = p.roomCode; b.seat = p.seat; });
    s.on('room-joined', (p) => { b.room = p.roomCode; b.seat = p.seat; });
    s.on('error', (e) => { b.errors.push(e.message); });
    s.on('game-over', (p) => { b.over = p; });
    s.on('round-complete', () => { b.rounds++; });
    // Anything that moves the table → pull this seat's authoritative view.
    for (const ev of ['game-started', 'hand-dealt', 'game-type-selected', 'trump-selected',
      'cards-discarded', 'card-played', 'trick-complete', 'round-complete', 'round-started', 'hand-updated']) {
      s.on(ev, () => s.emit('request-state'));
    }
    s.on('game-state', (st) => act(b, st));
    s.on('connect', () => resolve(b));
  });
}

/** Decide this seat's move from a snapshot — at most once per table position. */
function act(b, st) {
  if (b.over || st.isGameOver) return;
  const me = b.seat;
  const key = `${st.round}|${st.phase}|${st.trickNumber}|${st.currentTrick.length}|${st.hand.length}`;
  if (key === b.lastKey) return;
  const hand = [...st.hand].sort(byCard);

  if (st.phase === 'type_selection' && st.leaderSeat === me) {
    b.lastKey = key;
    const used = st.usedTypes[me] || [];
    b.s.emit('select-game-type', { typeCode: TYPE_ORDER.find((t) => !used.includes(t)) });
  } else if (st.phase === 'trump_selection' && st.leaderSeat === me) {
    b.lastKey = key;
    b.s.emit('select-trump', { suit: 'S' });
  } else if (st.phase === 'discard' && st.leaderSeat === me) {
    b.lastKey = key;
    const centre = st.lastCenterCards || [];
    const ok = hand.filter((c) => canDiscard(st.chosenGameType, c));
    let pick = null;
    for (let i = 0; i < ok.length && !pick; i++) {
      for (let j = i + 1; j < ok.length && !pick; j++) {
        const both = centre.length === 2 && centre.some((x) => same(x, ok[i])) && centre.some((x) => same(x, ok[j]));
        if (!both) pick = [ok[i], ok[j]];
      }
    }
    b.s.emit('discard-cards', { cards: pick });
  } else if (st.phase === 'playing' && st.currentTurn === me) {
    b.lastKey = key;
    // The engine's own rule check, run against this seat's view.
    const view = {
      phase: 'playing', currentTurn: me, hands: { [me]: st.hand },
      currentTrick: st.currentTrick, chosenGameType: st.chosenGameType,
      ledSuit: st.ledSuit, trumpSuit: st.trumpSuit,
    };
    const card = hand.find((c) => GameState.prototype.validatePlay.call(view, me, c).valid);
    b.s.emit('play-card', { card });
  } else if (st.phase === 'round_end' && me === 0) {
    b.lastKey = key;
    b.s.emit('next-round');
  }
}

(async () => {
  await sleep(300);
  const [a, c2, c3] = [await bot('Bot-A'), await bot('Bot-B'), await bot('Bot-C')];
  a.s.emit('create-room', { playerName: a.name, mode: 'championship' });
  await sleep(300);
  check('room created', !!a.room, JSON.stringify(a.errors));
  for (const b of [c2, c3]) { b.s.emit('join-room', { roomCode: a.room, playerName: b.name }); await sleep(200); }
  check('everyone seated', c2.seat === 1 && c3.seat === 2, `${c2.seat} ${c3.seat}`);
  a.s.emit('start-game');

  const started = Date.now();
  while (!(a.over && c2.over && c3.over) && Date.now() - started < 120000) await sleep(50);
  check('game reached game-over for all three', !!(a.over && c2.over && c3.over));
  check('27 rounds completed', a.rounds === 27, `${a.rounds}`);
  check('no bot move was rejected', [a, c2, c3].every((b) => b.errors.length === 0),
    JSON.stringify([a.errors, c2.errors, c3.errors]));
  const over = a.over || {};
  check('championship mode carried to game-over', over.mode === 'championship', over.mode);
  check('27 round details', (over.roundDetails || []).length === 27);

  // The server's own save is fire-and-forget; give it a moment.
  const scorePart = [0, 1, 2].map((s) => over.finalScores?.[s] ?? 0).join('.').replace(/-/g, 'n');
  const id = `g_${a.room}_${over.winner?.seat}_${scorePart}`;
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) { saved = await store.getGame(id); if (!saved) await sleep(100); }
  check('finished game saved to the database', !!saved, id);
  check('saved as championship', saved?.isChampionship === true);
  check('saved round details match game-over', JSON.stringify(saved?.roundDetails) === JSON.stringify(over.roundDetails));
  check('saved winners match game-over', JSON.stringify(saved?.winners) === JSON.stringify(over.winners));
  const quota = await store.getChampionshipQuota('Bot-A');
  check('the game counts toward the daily championship quota', quota.playedToday >= 1, JSON.stringify(quota));

  const { playedAt: _p, ...stable } = saved || {};
  const digest = crypto.createHash('sha256').update(JSON.stringify({ over: { ...over, players: undefined }, stable })).digest('hex');
  console.log(`\n  room ${a.room}  scores ${scorePart}  winner seat ${over.winner?.seat}`);
  console.log(`  digest ${digest}`);
  console.log(`\nfullgame: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
