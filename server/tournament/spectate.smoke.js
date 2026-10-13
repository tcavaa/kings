'use strict';

// The security test for tournament spectating.
//
// A watcher must see the table — cards played, tricks, scores — and never a
// hand. This drives a real 6-player tournament, finishes one table, attaches
// one of its players as a spectator on the other table, then plays real cards
// there while recording EVERY event the spectator receives. Any card that
// isn't on the table showing up in that recording is a failure.
//
// Run: DATABASE_URL=postgres://localhost/kings_test PORT=3404 node tournament/spectate.smoke.js

const { startServer, connectClient, waitFor, sleep, check, summary, run } = require('../test/harness');

const URL = startServer(3404);
const same = (a, b) => a.rank === b.rank && a.suit === b.suit;

async function client(name) {
  const s = await connectClient(URL, { name });
  s.hand = [];
  s.on('room-joined', (p) => { s.roomCode = p.roomCode; s.seat = p.seat; });
  s.on('hand-dealt', (p) => { s.hand = p.hand || []; s.leaderSeat = p.leaderSeat; });
  s.on('hand-updated', (p) => { s.hand = p.hand || []; });
  s.on('game-state', (p) => { if (p.hand?.length) s.hand = p.hand; });
  // card-played carries currentTurn/ledSuit, which is how the test knows
  // whose turn it is and what suit must be followed.
  s.on('card-played', (p) => {
    s.currentTurn = p.currentTurn; s.ledSuit = p.ledSuit;
    if (p.seat === s.seat) s.hand = s.hand.filter((c) => !same(c, p.card));
  });
  s.on('trick-complete', (p) => { s.currentTurn = p.nextTurn; s.ledSuit = null; });
  s.on('cards-discarded', (p) => { s.currentTurn = p.currentTurn; });
  return s;
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

run(async () => {
  const names = ['სპეკ-1', 'სპეკ-2', 'სპეკ-3', 'სპეკ-4', 'სპეკ-5', 'სპეკ-6'];
  const cs = [];
  for (const n of names) cs.push(await client(n));

  cs[0].emit('tournament-create', { playerName: names[0], size: 6 });
  await waitFor(() => cs[0].last('tournament-joined'));
  const code = cs[0].last('tournament-joined').code;
  for (let i = 1; i < 6; i++) {
    cs[i].emit('tournament-join', { code, playerName: names[i] });
    await waitFor(() => cs[i].last('tournament-joined'));
  }
  await waitFor(() => cs.every((c) => c.hand.length));

  const tables = [...new Set(cs.map((c) => c.roomCode))];
  check('two tables were drawn', tables.length === 2, `got ${tables.length}`);

  const tableA = cs.filter((c) => c.roomCode === tables[0]);
  const tableB = cs.filter((c) => c.roomCode === tables[1]);

  // Finish table A so its players are free to watch.
  tableA[0].emit('propose-quit', { kind: 'game' });
  await waitFor(() => tableA[1].last('quit-proposal') && tableA[2].last('quit-proposal'));
  tableA[1].emit('vote-quit', { accept: true });
  tableA[2].emit('vote-quit', { accept: true });
  await waitFor(() => tableA.every((c) => c.last('game-over')));

  // ── attach a watcher to the still-running table B ───────────────────────
  const watcher = tableA[0];
  watcher.events.length = 0;            // audit only what arrives from here
  watcher.emit('tournament-spectate', { roomCode: tables[1], playerName: watcher.playerName });
  await waitFor(() => watcher.last('spectate-started') && watcher.last('game-state'));
  const state = watcher.last('game-state');

  check('spectating was accepted', !!watcher.last('spectate-started'), JSON.stringify(watcher.errors));
  check('watcher got the table roster', watcher.last('spectate-started')?.players?.length === 3);
  check('watcher received a masked state', state?.spectator === true);
  check('masked state has no hand', Array.isArray(state?.hand) && state.hand.length === 0);
  check('masked state hides the prikup',
    Array.isArray(state?.centerCards) && state.centerCards.length === 0);
  check('watcher still sees card counts',
    state?.cardCounts && Object.keys(state.cardCounts).length === 3);
  check('watcher sees the scores', !!state?.cumulativeScores);

  // You may not watch your own table.
  const selfWatch = tableB[0];
  selfWatch.errors.length = 0;
  selfWatch.emit('tournament-spectate', { roomCode: tables[1], playerName: selfWatch.playerName });
  check('cannot spectate the table you are playing at', await waitFor(() => selfWatch.errors.length > 0));

  // An outsider may not watch at all.
  const outsider = await client('outsider');
  outsider.emit('tournament-spectate', { roomCode: tables[1], playerName: 'outsider' });
  check('a non-entrant is refused',
    await waitFor(() => outsider.errors.length > 0) && !outsider.last('spectate-started'));
  outsider.close();

  // ── play real cards at table B while the watcher records ────────────────
  // The felt has to actually have cards on it, otherwise the leak audit below
  // is checking nothing. 'Q' is a non-trump type, so the flow is
  // type_selection → discard (leader sheds 2, never a queen) → playing.
  const leader = tableB.find((c) => c.seat === c.leaderSeat) || tableB[0];
  leader.emit('select-game-type', { typeCode: 'Q' });
  await waitFor(() => leader.hand.length === 12);
  leader.emit('discard-cards', { cards: leader.hand.filter((c) => c.rank !== 'Q').slice(0, 2) });
  await waitFor(() => tableB.every((c) => c.currentTurn !== undefined));

  const bySeat = new Map(tableB.map((c) => [c.seat, c]));
  let played = 0;
  for (let i = 0; i < 12; i++) {
    // Whoever is on turn plays a legal card: follow the led suit if able.
    const actor = bySeat.get(tableB[0].currentTurn);
    if (!actor || !actor.hand.length) { await sleep(100); continue; }
    const led = tableB[0].ledSuit;
    const card = (led && actor.hand.find((c) => c.suit === led)) || actor.hand[0];
    const seen = tableB[0].all('card-played').length + tableB[0].all('trick-complete').length
      + tableB[0].all('round-complete').length;
    actor.emit('play-card', { card });
    played += 1;
    await waitFor(() => tableB[0].all('card-played').length + tableB[0].all('trick-complete').length
      + tableB[0].all('round-complete').length > seen || actor.errors.length);
    if (tableB[0].last('round-complete')) break;
  }
  await sleep(300);
  check('cards were actually played at the watched table', played >= 6, `played ${played}`);

  // ── the audit ───────────────────────────────────────────────────────────
  const leaks = [];
  let sawTableAction = false;
  for (const { event, payload } of watcher.events) {
    if (event === 'card-played' || event === 'trick-complete') sawTableAction = true;
    // Cards legitimately on the table.
    if (['card-played', 'trick-complete', 'round-complete', 'game-over', 'game-state'].includes(event)) {
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
  check('watcher was never dealt a hand', !watcher.events.some((e) => e.event === 'hand-dealt'));

  // ── watchers can talk ───────────────────────────────────────────────────
  const listener = tableB[0];
  const heardBefore = listener.all('chat-message').length;
  watcher.emit('chat-message', { message: 'გამარჯობა მაგიდიდან' });
  await waitFor(() => listener.all('chat-message').length > heardBefore);
  const heard = listener.all('chat-message').find((m) => m.name === watcher.playerName);
  check('watcher chat reaches the table', !!heard, JSON.stringify(listener.all('chat-message')));
  check('watcher chat is flagged as a spectator', heard?.spectator === true);
  check('watcher chat carries no seat', heard?.seat === null);

  // ── detaching ───────────────────────────────────────────────────────────
  watcher.emit('stop-watching');
  await waitFor(() => watcher.last('spectate-stopped'));
  const before = watcher.events.length;
  tableB[1].emit('chat-message', { message: 'after detach' });
  await waitFor(() => tableB[0].all('chat-message').some((m) => m.message === 'after detach'));
  await sleep(200);
  const gotAfter = watcher.events.slice(before).filter((e) => e.event === 'chat-message').length;
  check('detached watcher stops receiving the table', gotAfter === 0, `got ${gotAfter}`);

  cs.forEach((c) => c.close());
  summary();
});
