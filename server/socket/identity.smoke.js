'use strict';

// Who may sit where, over real sockets: a seat can only be taken back by the
// browser that holds it (or its verified profile), a PIN-protected name needs
// the profile's session token, leaving a running game keeps the seat, a socket
// that sits somewhere new lets go of its old room, and a tournament entrant
// whose socket blips is still seated when the draw happens.
//
// Needs a database (profiles, sessions): run against a local one, e.g.
//   DATABASE_URL=postgres://postgres@localhost:55432/kings_test PORT=3406 node socket/identity.smoke.js

const { startServer, connectClient, waitFor, sleep, check, summary, run } = require('../test/harness');
const store = require('../db/store');

const URL = startServer(3406);
// Unique per run: tournaments and rooms from earlier runs are restored from the
// database, and a reused browser key would still own their seats.
const RUN = Date.now().toString(36);
const key = (n) => `test-client-key-${n}-${RUN}-${'x'.repeat(16)}`;
/** A client with its own browser key that records what it is told. */
const client = (n) => connectClient(URL, { clientKey: key(n) });
const joined = (s) => s.last('room-joined') || s.last('room-created');

run(async () => {
  // ── a seat belongs to the browser that took it ────────────────────────────
  const a = await client('a');
  const b = await client('b');
  const c = await client('c');
  a.emit('create-room', { playerName: 'იდ-ანა', mode: 'public' });
  await waitFor(() => joined(a));
  const room = joined(a)?.roomCode;
  check('room created', !!room);
  b.emit('join-room', { roomCode: room, playerName: 'იდ-ბექა' });
  c.emit('join-room', { roomCode: room, playerName: 'იდ-ცირა' });
  await waitFor(() => a.last('player-joined')?.players.length === 3);
  a.emit('start-game');
  await waitFor(() => a.last('hand-dealt'));
  check('game started with a hand', Array.isArray(a.last('hand-dealt')?.hand) && a.last('hand-dealt').hand.length > 0);
  a.emit('start-game');
  await sleep(200);
  check('a second start tap is ignored quietly', a.errors.length === 0, JSON.stringify(a.errors));

  const thief = await client('thief');
  thief.emit('join-room', { roomCode: room, playerName: 'იდ-ანა' });
  await waitFor(() => thief.errors.length);
  check('a stranger using a seated name is refused',
    thief.errors.some((e) => /already taken/.test(e.message)), JSON.stringify(thief.errors));
  check('the stranger never sees a hand', !thief.last('game-state') && !joined(thief));

  a.emit('select-game-type', { typeCode: 'K' });
  await waitFor(() => a.last('game-type-selected'));
  check('the real player still holds the seat', !a.errors.length, JSON.stringify(a.errors));

  // Same browser, new socket (a refresh): the seat comes back.
  a.close();
  await waitFor(() => b.last('player-disconnected'));
  const a2 = await client('a');
  a2.emit('join-room', { roomCode: room, playerName: 'იდ-ანა' });
  await waitFor(() => a2.last('game-state'));
  check('the same browser reconnects to its seat', joined(a2)?.reconnected === true && joined(a2).seat === 0);
  check('and gets its hand back', Array.isArray(a2.last('game-state')?.hand) && a2.last('game-state').hand.length > 0);

  // ── leaving a running game keeps the seat ─────────────────────────────────
  const disconnects = c.all('player-disconnected').length;
  b.emit('leave-room');
  await waitFor(() => c.all('player-disconnected').length > disconnects);
  check('the others hear a disconnect, not a departure',
    c.all('player-disconnected').length > disconnects && !c.last('player-left'));
  const b2 = await client('b');
  b2.emit('join-room', { roomCode: room, playerName: 'იდ-ბექა' });
  await waitFor(() => joined(b2));
  check('the leaver can come back to their seat', joined(b2)?.reconnected === true && joined(b2).seat === 1);

  // ── a socket that sits somewhere new lets go of its old room ──────────────
  const host = await client('host');
  const guest = await client('guest');
  host.emit('create-room', { playerName: 'იდ-მასპინძელი', mode: 'public' });
  await waitFor(() => joined(host));
  guest.emit('join-room', { roomCode: joined(host).roomCode, playerName: 'იდ-სტუმარი' });
  await waitFor(() => host.last('player-joined')?.players.length === 2);
  guest.emit('create-room', { playerName: 'იდ-სტუმარი', mode: 'public' });
  check('the old waiting room hears the guest leave',
    await waitFor(() => host.last('player-left')?.players.length === 1), JSON.stringify(host.last('player-left')));
  check('with the remaining photos intact', 'avatar' in (host.last('player-left')?.players[0] || {}));
  const hostChat = host.all('chat-message').length;
  guest.emit('chat-message', { message: 'ძველ ოთახში?' });
  await sleep(300);
  check('and no longer hears from it', host.all('chat-message').length === hostChat);

  // ── a PIN-protected name needs the profile's session ──────────────────────
  const profileId = `p_idsmoke_${Date.now()}`;
  const pinName = `იდ-პინი-${profileId.slice(-6)}`;   // unique, so the test can re-run
  await store.upsertProfile({ id: profileId, name: pinName, pin: '4321' });
  const token = await store.createProfileSession(profileId);

  const impostor = await client('imp');
  impostor.emit('create-room', { playerName: pinName, mode: 'public' });
  await waitFor(() => impostor.errors.length);
  check('a PIN-protected name without a session is refused',
    impostor.errors.some((e) => e.code === 'AUTH') && !joined(impostor), JSON.stringify(impostor.errors));

  const forged = await client('forged');
  forged.emit('create-room', { playerName: pinName, profileToken: 'not-a-real-token-at-all', mode: 'public' });
  await waitFor(() => forged.errors.length);
  check('a made-up session is refused', forged.errors.some((e) => e.code === 'AUTH') && !joined(forged));

  const owner = await client('owner');
  owner.emit('create-room', { playerName: 'someone else', profileToken: token, mode: 'public' });
  await waitFor(() => owner.last('player-joined'));
  const ownerRoom = joined(owner)?.roomCode;
  check('the session holder plays as the profile', !!ownerRoom);
  const seatedAs = owner.last('player-joined')?.players[0];
  check('under the profile\'s own name, whatever was typed', seatedAs?.name === pinName, JSON.stringify(seatedAs));

  // Another device of the same profile may take the seat back.
  const ownerPhone = await client('owner-phone');
  ownerPhone.emit('join-room', { roomCode: ownerRoom, profileToken: token });
  await waitFor(() => joined(ownerPhone));
  check('the profile can reclaim its seat from another device', joined(ownerPhone)?.reconnected === true);

  // ── a tournament entrant who blips is still seated at the draw ────────────
  const t = [];
  for (let i = 0; i < 6; i++) t.push(await client(`t${i}`));
  t[0].emit('tournament-create', { playerName: 'იდ-ტ0', size: 6 });
  await waitFor(() => t[0].last('tournament-joined'));
  const code = t[0].last('tournament-joined')?.code;
  for (let i = 1; i < 5; i++) {
    t[i].emit('tournament-join', { code, playerName: `იდ-ტ${i}` });
    await waitFor(() => t[i].last('tournament-joined'));
  }

  const intruder = await client('t-intruder');
  intruder.emit('tournament-join', { code, playerName: 'იდ-ტ1' });
  await waitFor(() => intruder.errors.length);
  check('a stranger can\'t take a tournament entry by name',
    intruder.errors.some((e) => /already in this tournament/.test(e.message)));

  // Entrant 1 drops: the roster shows it, and they come back on a new socket.
  t[1].close();
  check('the lobby roster shows the dropout offline',
    await waitFor(() => t[0].last('tournament-state')?.players.find((p) => p.name === 'იდ-ტ1')?.connected === false));
  const back = await client('t1');
  back.emit('tournament-join', { code, playerName: 'იდ-ტ1' });
  await waitFor(() => back.last('tournament-joined'));
  check('the rejoining entrant is back in the lobby', back.last('tournament-joined')?.code === code);

  t[5].emit('tournament-join', { code, playerName: 'იდ-ტ5' });
  await waitFor(() => back.last('hand-dealt'));
  check('the draw seats the rejoined entrant on their new socket',
    joined(back)?.roomCode && Array.isArray(back.last('hand-dealt')?.hand), JSON.stringify(joined(back)));

  // And a blip during the semifinal: the bracket table and tournament follow.
  back.close();
  await sleep(200);
  const back2 = await client('t1');
  back2.emit('tournament-join', { code, playerName: 'იდ-ტ1' });
  await waitFor(() => joined(back2));
  check('a mid-bracket rejoin seats them back at their table',
    joined(back2)?.reconnected === true && joined(back2).tournament?.code === code, JSON.stringify(joined(back2)));

  // ── one table at a time ───────────────────────────────────────────────────
  const sitter = await client('sitter');
  sitter.emit('sit-public', { playerName: 'იდ-მჯდომი', mode: 'public' });
  await waitFor(() => sitter.last('public-seated'));
  sitter.emit('tournament-create', { playerName: 'იდ-მჯდომი', size: 6 });
  await waitFor(() => sitter.errors.length);
  check('a seated player can\'t open a tournament',
    sitter.errors.some((e) => /leave it first/.test(e.message)) && !sitter.last('tournament-joined'), JSON.stringify(sitter.errors));

  const entrant = await client('entrant');
  entrant.emit('tournament-create', { playerName: 'იდ-შემსვლელი', size: 6 });
  check('the entrant is in a tournament lobby', await waitFor(() => entrant.last('tournament-joined')));
  entrant.emit('sit-public', { playerName: 'იდ-შემსვლელი', mode: 'public' });
  entrant.emit('create-room', { playerName: 'იდ-შემსვლელი', mode: 'public' });
  await waitFor(() => entrant.errors.length === 2);
  check('a tournament entrant can\'t sit or open a room',
    entrant.errors.filter((e) => /tournament/.test(e.message)).length === 2 && !joined(entrant),
    JSON.stringify(entrant.errors));

  // ── a homepage table joined by its code still starts at three ─────────────
  // The sitter from above holds a seat there; stand them up first.
  sitter.emit('stand-public');
  await waitFor(() => sitter.last('public-unseated'));
  const q = [await client('q0'), await client('q1'), await client('q2')];
  q[0].emit('sit-public', { playerName: 'იდ-ქ0', mode: 'public' });
  await waitFor(() => q[0].last('public-seated'));
  q[1].emit('sit-public', { playerName: 'იდ-ქ1', mode: 'public' });
  await waitFor(() => q[1].last('public-seated'));
  const quick = q[0].last('public-seated')?.roomCode;
  q[2].emit('join-room', { roomCode: quick, playerName: 'იდ-ქ2' });
  check('joining a homepage table by code fills and starts it',
    await waitFor(() => q.every((s) => s.last('hand-dealt'))), JSON.stringify(q.map((s) => !!s.last('hand-dealt'))));

  summary();
});
