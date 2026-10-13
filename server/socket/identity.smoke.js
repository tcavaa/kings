'use strict';

// Who may sit where, over real sockets: a seat can only be taken back by the
// browser that holds it (or its verified profile), a PIN-protected name needs
// the profile's session token, leaving a running game keeps the seat, and a
// tournament entrant whose socket blips is still seated when the draw happens.
//
// Needs a database (profiles, sessions): run against a local one, e.g.
//   DATABASE_URL=postgres://postgres@localhost:55432/kings_test PORT=3406 node socket/identity.smoke.js

process.env.PORT = process.env.PORT || '3406';
require('../index.js');

const { io } = require('socket.io-client');
const store = require('../db/store');

const URL = `http://localhost:${process.env.PORT}`;
let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`  ok  ${name}`); }
  else { failed += 1; console.error(`FAIL  ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (n) => `test-client-key-${n}-${'x'.repeat(16)}`;

/** A client with its own browser key that records what it is told. */
function client(clientKey) {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, auth: { clientKey } });
    s.events = [];
    s.errors = [];
    s.onAny((event, payload) => s.events.push({ event, payload }));
    s.on('error', (e) => s.errors.push(e));
    s.on('room-joined', (p) => { s.joined = p; });
    s.on('room-created', (p) => { s.joined = p; });
    s.on('game-state', (p) => { s.state = p; });
    s.on('hand-dealt', (p) => { s.hand = p; });
    s.on('tournament-joined', (p) => { s.tournament = p; });
    s.on('connect', () => resolve(s));
  });
}

(async () => {
  // ── a seat belongs to the browser that took it ────────────────────────────
  const a = await client(key('a'));
  const b = await client(key('b'));
  const c = await client(key('c'));
  a.emit('create-room', { playerName: 'იდ-ანა', mode: 'public' });
  await sleep(300);
  const room = a.joined?.roomCode;
  check('room created', !!room);
  b.emit('join-room', { roomCode: room, playerName: 'იდ-ბექა' });
  c.emit('join-room', { roomCode: room, playerName: 'იდ-ცირა' });
  await sleep(300);
  a.emit('start-game');
  await sleep(400);
  check('game started with a hand', Array.isArray(a.hand?.hand) && a.hand.hand.length > 0);

  const thief = await client(key('thief'));
  thief.emit('join-room', { roomCode: room, playerName: 'იდ-ანა' });
  await sleep(300);
  check('a stranger using a seated name is refused',
    thief.errors.some((e) => /already taken/.test(e.message)), JSON.stringify(thief.errors));
  check('the stranger never sees a hand', !thief.state && !thief.joined);

  a.emit('select-game-type', { typeCode: 'K' });
  await sleep(200);
  check('the real player still holds the seat', !a.errors.length, JSON.stringify(a.errors));

  // Same browser, new socket (a refresh): the seat comes back.
  a.close();
  await sleep(300);
  const a2 = await client(key('a'));
  a2.emit('join-room', { roomCode: room, playerName: 'იდ-ანა' });
  await sleep(400);
  check('the same browser reconnects to its seat', a2.joined?.reconnected === true && a2.joined.seat === 0);
  check('and gets its hand back', Array.isArray(a2.state?.hand) && a2.state.hand.length > 0);

  // ── leaving a running game keeps the seat ─────────────────────────────────
  b.emit('leave-room');
  await sleep(300);
  check('the others hear a disconnect, not a departure',
    c.events.some((e) => e.event === 'player-disconnected') && !c.events.some((e) => e.event === 'player-left'));
  const b2 = await client(key('b'));
  b2.emit('join-room', { roomCode: room, playerName: 'იდ-ბექა' });
  await sleep(400);
  check('the leaver can come back to their seat', b2.joined?.reconnected === true && b2.joined.seat === 1);

  // ── a PIN-protected name needs the profile's session ──────────────────────
  const profileId = `p_idsmoke_${Date.now()}`;
  const pinName = `იდ-პინი-${profileId.slice(-6)}`;   // unique, so the test can re-run
  await store.upsertProfile({ id: profileId, name: pinName, pin: '4321' });
  const token = await store.createProfileSession(profileId);

  const impostor = await client(key('imp'));
  impostor.emit('create-room', { playerName: pinName, mode: 'public' });
  await sleep(300);
  check('a PIN-protected name without a session is refused',
    impostor.errors.some((e) => e.code === 'AUTH') && !impostor.joined, JSON.stringify(impostor.errors));

  const forged = await client(key('forged'));
  forged.emit('create-room', { playerName: pinName, profileToken: 'not-a-real-token-at-all', mode: 'public' });
  await sleep(300);
  check('a made-up session is refused', forged.errors.some((e) => e.code === 'AUTH') && !forged.joined);

  const owner = await client(key('owner'));
  owner.emit('create-room', { playerName: 'someone else', profileToken: token, mode: 'public' });
  await sleep(300);
  const ownerRoom = owner.joined?.roomCode;
  check('the session holder plays as the profile', !!ownerRoom);
  const seatedAs = owner.events.find((e) => e.event === 'player-joined')?.payload.players[0];
  check('under the profile\'s own name, whatever was typed', seatedAs?.name === pinName, JSON.stringify(seatedAs));

  // Another device of the same profile may take the seat back.
  const ownerPhone = await client(key('owner-phone'));
  ownerPhone.emit('join-room', { roomCode: ownerRoom, profileToken: token });
  await sleep(300);
  check('the profile can reclaim its seat from another device', ownerPhone.joined?.reconnected === true);

  // ── a tournament entrant who blips is still seated at the draw ────────────
  const t = [];
  for (let i = 0; i < 6; i++) t.push(await client(key(`t${i}`)));
  t[0].emit('tournament-create', { playerName: 'იდ-ტ0', size: 6 });
  await sleep(300);
  const code = t[0].tournament?.code;
  for (let i = 1; i < 5; i++) { t[i].emit('tournament-join', { code, playerName: `იდ-ტ${i}` }); await sleep(150); }

  const intruder = await client(key('t-intruder'));
  intruder.emit('tournament-join', { code, playerName: 'იდ-ტ1' });
  await sleep(300);
  check('a stranger can\'t take a tournament entry by name',
    intruder.errors.some((e) => /already in this tournament/.test(e.message)));

  // Entrant 1 drops and comes back on a new socket before the draw.
  t[1].close();
  await sleep(300);
  const back = await client(key('t1'));
  back.emit('tournament-join', { code, playerName: 'იდ-ტ1' });
  await sleep(300);
  check('the rejoining entrant is back in the lobby', back.tournament?.code === code);

  t[5].emit('tournament-join', { code, playerName: 'იდ-ტ5' });
  await sleep(1200);
  check('the draw seats the rejoined entrant on their new socket',
    back.joined?.roomCode && Array.isArray(back.hand?.hand), JSON.stringify(back.joined));

  // And a blip during the semifinal: the bracket table and tournament follow.
  back.close();
  await sleep(300);
  const back2 = await client(key('t1'));
  back2.emit('tournament-join', { code, playerName: 'იდ-ტ1' });
  await sleep(500);
  check('a mid-bracket rejoin seats them back at their table',
    back2.joined?.reconnected === true && back2.joined.tournament?.code === code, JSON.stringify(back2.joined));

  // ── one table at a time ───────────────────────────────────────────────────
  const sitter = await client(key('sitter'));
  sitter.emit('sit-public', { playerName: 'იდ-მჯდომი', mode: 'public' });
  await sleep(300);
  sitter.emit('tournament-create', { playerName: 'იდ-მჯდომი', size: 6 });
  await sleep(300);
  check('a seated player can\'t open a tournament',
    sitter.errors.some((e) => /leave it first/.test(e.message)) && !sitter.tournament, JSON.stringify(sitter.errors));

  const entrant = await client(key('entrant'));
  entrant.emit('tournament-create', { playerName: 'იდ-შემსვლელი', size: 6 });
  await sleep(300);
  check('the entrant is in a tournament lobby', !!entrant.tournament);
  entrant.emit('sit-public', { playerName: 'იდ-შემსვლელი', mode: 'public' });
  entrant.emit('create-room', { playerName: 'იდ-შემსვლელი', mode: 'public' });
  await sleep(400);
  check('a tournament entrant can\'t sit or open a room',
    entrant.errors.filter((e) => /tournament/.test(e.message)).length === 2 && !entrant.joined,
    JSON.stringify(entrant.errors));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
