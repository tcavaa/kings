'use strict';

// The security test for tournament spectating.
//
// A watcher must see the table — cards played, tricks, scores — and never a
// hand. This drives a real 6-player tournament, finishes one table, attaches
// one of its players as a spectator on the other table, then plays real cards
// there while recording EVERY event the spectator receives. Any card that
// isn't on the table showing up in that recording is a failure.
//
// Run: PORT=3404 node tournament/spectate.smoke.js

process.env.PORT = process.env.PORT || '3404';
require('../index.js');

const { io } = require('socket.io-client');

const URL = `http://localhost:${process.env.PORT}`;
let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`  ok  ${name}`); }
  else { failed += 1; console.error(`FAIL  ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.playerName = name;
    s.received = [];          // every event, for the leak audit
    s.hand = [];
    s.state = null;
    s.chat = [];
    s.errs = [];
    s.onAny((event, payload) => s.received.push({ event, payload }));
    s.on('error', (e) => s.errs.push(e));
    s.on('room-joined', (p) => { s.roomCode = p.roomCode; s.seat = p.seat; });
    s.on('hand-dealt', (p) => { s.hand = p.hand || []; s.state = p; });
    s.on('hand-updated', (p) => { s.hand = p.hand || []; });
    s.on('game-state', (p) => { s.state = p; if (p.hand) s.hand = p.hand; });
    // card-played carries currentTurn/ledSuit, which is how the test knows
    // whose turn it is and what suit must be followed.
    s.on('card-played', (p) => {
      s.currentTurn = p.currentTurn; s.ledSuit = p.ledSuit;
      if (p.seat === s.seat) s.hand = s.hand.filter((c) => !(c.rank === p.card.rank && c.suit === p.card.suit));
    });
    s.on('trick-complete', (p) => { s.currentTurn = p.nextLeader ?? p.winnerSeat; s.ledSuit = null; });
    s.on('cards-discarded', (p) => { s.currentTurn = p.currentTurn; s.phase = p.phase; });
    s.on('game-type-selected', (p) => { s.phase = p.phase; s.currentTurn = p.currentTurn; });
    s.on('tournament-joined', (p) => { s.tournament = p; });
    s.on('tournament-state', (p) => { s.tournament = p; });
    s.on('spectate-started', (p) => { s.spectating = p; });
    s.on('chat-message', (p) => { s.chat.push(p); });
    s.on('connect', () => resolve(s));
  });
}

/** Deep scan for anything that looks like a playing card. */
function findCards(value, trail = '') {
  const hits = [];
  const walk = (v, at) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (v && typeof v === 'object') {
      // A card is { rank, suit }.
      if ('rank' in v && 'suit' in v) hits.push({ at, card: `${v.rank}${v.suit}` });
      for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
    }
  };
  walk(value, trail);
  return hits;
}

(async () => {
  const names = ['სპეკ-1', 'სპეკ-2', 'სპეკ-3', 'სპეკ-4', 'სპეკ-5', 'სპეკ-6'];
  const cs = [];
  for (const n of names) cs.push(await client(n));

  cs[0].emit('tournament-create', { playerName: names[0], size: 6 });
  await sleep(400);
  const code = cs[0].tournament.code;
  for (let i = 1; i < 6; i++) {
    cs[i].emit('tournament-join', { code, playerName: names[i] });
    await sleep(150);
  }
  await sleep(1400);

  const tables = [...new Set(cs.map((c) => c.roomCode))];
  check('two tables were drawn', tables.length === 2, `got ${tables.length}`);

  const tableA = cs.filter((c) => c.roomCode === tables[0]);
  const tableB = cs.filter((c) => c.roomCode === tables[1]);

  // Finish table A so its players are free to watch.
  tableA[0].emit('propose-quit', { kind: 'game' });
  await sleep(250);
  tableA[1].emit('vote-quit', { accept: true });
  tableA[2].emit('vote-quit', { accept: true });
  await sleep(900);

  // ── attach a watcher to the still-running table B ───────────────────────
  const watcher = tableA[0];
  watcher.received.length = 0;            // audit only what arrives from here
  watcher.emit('tournament-spectate', { roomCode: tables[1], playerName: watcher.playerName });
  await sleep(600);

  check('spectating was accepted', !!watcher.spectating, JSON.stringify(watcher.errs));
  check('watcher got the table roster', watcher.spectating?.players?.length === 3);
  check('watcher received a masked state', watcher.state?.spectator === true);
  check('masked state has no hand', Array.isArray(watcher.state?.hand) && watcher.state.hand.length === 0);
  check('masked state hides the prikup',
    Array.isArray(watcher.state?.centerCards) && watcher.state.centerCards.length === 0);
  check('watcher still sees card counts',
    watcher.state?.cardCounts && Object.keys(watcher.state.cardCounts).length === 3);
  check('watcher sees the scores', !!watcher.state?.cumulativeScores);

  // You may not watch your own table.
  const selfWatch = tableB[0];
  selfWatch.errs.length = 0;
  selfWatch.emit('tournament-spectate', { roomCode: tables[1], playerName: selfWatch.playerName });
  await sleep(300);
  check('cannot spectate the table you are playing at', selfWatch.errs.length > 0);

  // An outsider may not watch at all.
  const outsider = await client('outsider');
  outsider.emit('tournament-spectate', { roomCode: tables[1], playerName: 'outsider' });
  await sleep(300);
  check('a non-entrant is refused', outsider.errs.length > 0 && !outsider.spectating);
  outsider.close();

  // ── play real cards at table B while the watcher records ────────────────
  // The felt has to actually have cards on it, otherwise the leak audit below
  // is checking nothing. 'Q' is a non-trump type, so the flow is
  // type_selection → discard (leader sheds 2) → playing.
  const leader = tableB.find((c) => c.seat === c.state?.leaderSeat) || tableB[0];
  leader.emit('select-game-type', { typeCode: 'Q' });
  await sleep(500);
  leader.emit('discard-cards', { cards: leader.hand.slice(0, 2) });
  await sleep(600);

  const bySeat = new Map(tableB.map((c) => [c.seat, c]));
  let played = 0;
  for (let i = 0; i < 12; i++) {
    // Whoever is on turn plays a legal card: follow the led suit if able.
    const turn = tableB.map((c) => c.currentTurn).find((t) => t !== undefined && t !== null);
    const actor = bySeat.get(turn);
    if (!actor || !actor.hand.length) { await sleep(200); continue; }
    const led = tableB.map((c) => c.ledSuit).find((l) => l);
    const card = (led && actor.hand.find((c) => c.suit === led)) || actor.hand[0];
    actor.emit('play-card', { card });
    played += 1;
    await sleep(300);
  }
  await sleep(900);
  check('cards were actually played at the watched table', played >= 6, `played ${played}`);

  // ── the audit ───────────────────────────────────────────────────────────
  const leaks = [];
  let sawTableAction = false;
  for (const { event, payload } of watcher.received) {
    if (event === 'card-played' || event === 'trick-complete') sawTableAction = true;
    // Cards legitimately on the table.
    if (['card-played', 'trick-complete', 'round-complete', 'game-over',
         'game-state', 'last-trick'].includes(event)) {
      // still check these for a `hand` specifically
      const p = payload || {};
      if (Array.isArray(p.hand) && p.hand.length) leaks.push({ event, why: 'hand', n: p.hand.length });
      if (p.hands) leaks.push({ event, why: 'hands' });
      if (Array.isArray(p.centerCards) && p.centerCards.length) {
        leaks.push({ event, why: 'centerCards', n: p.centerCards.length });
      }
      continue;
    }
    if (event === 'hand-dealt' || event === 'hand-updated') {
      leaks.push({ event, why: 'hand-bearing event delivered to a watcher' });
      continue;
    }
    const cards = findCards(payload, event);
    if (cards.length) leaks.push({ event, why: 'cards in payload', at: cards.slice(0, 3) });
  }

  check('watcher saw live table action', sawTableAction);
  check('NO cards leaked to the watcher', leaks.length === 0,
    `\n        ${JSON.stringify(leaks.slice(0, 6), null, 2)}`);
  check('watcher was never dealt a hand', watcher.hand.length === 0,
    `has ${watcher.hand.length} cards`);

  // ── watchers can talk ───────────────────────────────────────────────────
  const listener = tableB[0];
  listener.chat.length = 0;
  watcher.emit('chat-message', { message: 'გამარჯობა მაგიდიდან' });
  await sleep(400);
  const heard = listener.chat.find((m) => m.name === watcher.playerName);
  check('watcher chat reaches the table', !!heard, JSON.stringify(listener.chat));
  check('watcher chat is flagged as a spectator', heard?.spectator === true);
  check('watcher chat carries no seat', heard?.seat === null);

  // ── detaching ───────────────────────────────────────────────────────────
  watcher.emit('stop-watching');
  await sleep(300);
  listener.chat.length = 0;
  const before = watcher.received.length;
  tableB[1].emit('chat-message', { message: 'after detach' });
  await sleep(400);
  const gotAfter = watcher.received
    .slice(before)
    .filter((e) => e.event === 'chat-message').length;
  check('detached watcher stops receiving the table', gotAfter === 0, `got ${gotAfter}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  cs.forEach((c) => c.close());
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('spectate test threw:', err);
  process.exit(1);
});
