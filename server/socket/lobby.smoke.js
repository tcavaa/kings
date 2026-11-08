'use strict';

// Homepage presence and public watching.
//
// Covers who shows as online (and that two tabs collapse to one person),
// which King tables are advertised as watchable, that the lobby lists reach
// only the lobby (not players mid-game or watchers), and the text-and-
// reactions-only limit that applies to a watcher who wandered in off the
// lobby rather than out of a tournament. Also audits that no card ever
// reaches them.
//
// Run: DATABASE_URL=postgres://localhost/kings_test PORT=3520 node socket/lobby.smoke.js

const { startServer, connectClient, waitFor, sleep, check, summary, run } = require('../test/harness');

const URL = startServer(3520);

const lists = (s) => ({
  online: s.last('online-players') || [],
  live: s.last('live-games') || [],
});

run(async () => {
  const mk = (name) => connectClient(URL, { name });
  const [a, b, c, w, o] = [await mk('პრეზ-A'), await mk('პრეზ-B'), await mk('პრეზ-C'),
    await mk('მაყურებელი'), await mk('დამკვირვებელი')];

  // ── presence ──
  for (const s of [a, b, c, w, o]) s.emit('announce-presence', { playerName: s.playerName });
  check('all five appear online', await waitFor(() => lists(o).online.length === 5),
    JSON.stringify(lists(o).online.map((p) => p.name)));
  check('everyone starts in the lobby', lists(o).online.every((p) => p.status === 'lobby'));
  const pushes = o.all('online-players').length;
  check('a burst of announcements is batched', pushes < 5, `${pushes} pushes`);

  // Two tabs, one person.
  const dup = await mk('პრეზ-A');
  dup.emit('announce-presence', { playerName: 'პრეზ-A' });
  await sleep(400);
  check('a second tab does not duplicate the person', lists(o).online.length === 5, `${lists(o).online.length}`);
  dup.close();
  await sleep(300);

  // ── a live King game ──
  a.emit('create-room', { playerName: a.playerName, mode: 'public' });
  await waitFor(() => a.last('room-created'));
  const room = a.last('room-created').roomCode;
  b.emit('join-room', { roomCode: room, playerName: b.playerName });
  c.emit('join-room', { roomCode: room, playerName: c.playerName });
  await waitFor(() => a.last('player-joined')?.players.length === 3);
  a.emit('start-game');

  check('the game shows as watchable', await waitFor(() => lists(o).live.length === 1),
    JSON.stringify(lists(o).live.map((g) => g.roomCode)));
  const g = lists(o).live[0];
  check('lists its players and scores', g?.players?.length === 3 && typeof g.players[0].score === 'number');
  check('reports the round', typeof g?.round === 'number');
  check('presence flips the trio to playing',
    await waitFor(() => lists(o).online.filter((p) => p.status === 'playing').length === 3),
    JSON.stringify(lists(o).online.map((p) => `${p.name}:${p.status}`)));

  // Players at a running table don't get the lobby lists.
  const aPushes = a.all('online-players').length;
  o.emit('announce-presence', { playerName: 'დამკვირვებელი-2' });
  await waitFor(() => lists(o).online.some((p) => p.name === 'დამკვირვებელი-2'));
  await sleep(300);
  check('a player mid-game is not sent the lobby lists', a.all('online-players').length === aPushes);
  o.emit('announce-presence', { playerName: 'დამკვირვებელი' });

  // ── watch it ──
  w.events.length = 0;
  w.emit('watch-game', { roomCode: room, playerName: w.playerName });
  check('watching accepted', await waitFor(() => w.last('spectate-started')), JSON.stringify(w.errors));
  await waitFor(() => w.last('game-state'));
  check('watcher gets a masked state', w.last('game-state')?.spectator === true);
  check('no hand in the masked state', (w.last('game-state')?.hand || []).length === 0);
  check('the lobby counts the watcher', await waitFor(() => lists(o).live[0]?.watchers === 1),
    JSON.stringify(lists(o).live[0]));
  check('watcher status shows as watching',
    await waitFor(() => lists(o).online.find((p) => p.name === 'მაყურებელი')?.status === 'watching'));

  // ── text + emoji YES, voice + sound NO ──
  const fromWatcher = () => a.all('chat-message').filter((m) => m.name === 'მაყურებელი');
  w.emit('chat-message', { message: 'კარგი თამაშია' });
  check('watcher CAN chat', await waitFor(() => fromWatcher().length === 1), JSON.stringify(a.all('chat-message')));
  check('watcher chat flagged as spectator', fromWatcher()[0]?.spectator === true);

  w.emit('chat-react', { messageId: fromWatcher()[0]?.id, emoji: '❤️' });
  check('watcher CAN react with emoji', await waitFor(() => a.all('chat-reaction').length === 1));

  w.emit('voice-message', { audio: Buffer.alloc(64), mime: 'audio/webm', duration: 1 });
  w.emit('play-sound', { soundId: 'yeehaw', targetSeat: 0 });
  await sleep(350);
  check('watcher CANNOT send voice', a.all('voice-message').length === 0, `${a.all('voice-message').length} clips got through`);
  check('watcher CANNOT fire sound buttons', a.all('play-sound').length === 0, `${a.all('play-sound').length} sounds got through`);

  // Players are unaffected.
  a.emit('play-sound', { soundId: 'yeehaw', targetSeat: 0 });
  check('players CAN still fire sounds', await waitFor(() => a.all('play-sound').length === 1));

  // ── no card leaks to the public watcher ──
  const leaks = w.events.filter(({ event, payload: p }) =>
    (event === 'hand-dealt' || event === 'hand-updated') ||
    (Array.isArray(p?.hand) && p.hand.length) ||
    (Array.isArray(p?.centerCards) && p.centerCards.length) || p?.hands);
  check('NO cards leaked to the public watcher', leaks.length === 0, JSON.stringify(leaks.map((l) => l.event)));

  // A watcher's resync is answered with the watched table, masked.
  const states = w.all('game-state').length;
  w.emit('request-state');
  check('a watcher\'s resync gets the masked table',
    await waitFor(() => w.all('game-state').length === states + 1) && w.last('game-state')?.spectator === true);
  const version = w.last('game-state')?.version;
  w.emit('request-state', { version });
  check('a resync at the current version is answered "up to date"',
    await waitFor(() => w.last('state-current')?.version === version));

  // ── guards ──
  a.errors.length = 0;
  a.emit('watch-game', { roomCode: room, playerName: a.playerName });
  check('a seated player cannot watch their own table', await waitFor(() => a.errors.length > 0));

  // ── stop ──
  w.emit('stop-watching');
  check('the lobby sees the watcher leave', await waitFor(() => lists(o).live[0]?.watchers === 0),
    JSON.stringify(lists(o).live[0]));
  w.emit('lobby-info');
  check('back in the lobby, the watcher gets the lists again',
    await waitFor(() => lists(w).online.find((p) => p.name === 'მაყურებელი')?.status === 'lobby'));

  // ── the 4-seat homepage table ──
  // Sitting fills the 4-seat quick-match table (the 3-seat one is left
  // alone); the fourth sitter starts a 4-player game where the dealer rests.
  const four = [await mk('ოთხი-1'), await mk('ოთხი-2'), await mk('ოთხი-3'), await mk('ოთხი-4')];
  for (const s of four.slice(0, 3)) {
    s.emit('sit-public', { playerName: s.playerName, mode: 'championship', seatCount: 4 });
  }
  check('three sitters wait at the 4-seat table',
    await waitFor(() => o.last('public-room')?.championship4?.seats?.length === 3), JSON.stringify(o.last('public-room')));
  check('the 3-seat table is untouched', (o.last('public-room')?.championship?.seats || []).length === 0);
  check('the sitter is told which table', four[0].last('public-seated')?.table === 'championship4'
    && four[0].last('public-seated')?.seatCount === 4, JSON.stringify(four[0].last('public-seated')));
  four[3].emit('sit-public', { playerName: four[3].playerName, mode: 'championship', seatCount: 4 });
  check('the fourth sitter starts the game', await waitFor(() => four.every((s) => s.last('game-started'))));
  const gs4 = four[0].last('game-started');
  check('a 4-player game: 36 rounds, the dealer rests',
    gs4?.seatCount === 4 && gs4?.totalRounds === 36 && gs4?.restingSeat === 3 && gs4?.players?.length === 4,
    JSON.stringify({ seatCount: gs4?.seatCount, totalRounds: gs4?.totalRounds, restingSeat: gs4?.restingSeat }));
  check('the resting dealer is dealt no cards', await waitFor(() => four[3].last('hand-dealt'))
    && four[3].last('hand-dealt').hand.length === 0 && four[0].last('hand-dealt').hand.length === 10);
  check('the homepage 4-seat table is free again',
    await waitFor(() => (o.last('public-room')?.championship4?.seats || []).length === 0));

  [a, b, c, w, o, ...four].forEach((s) => s.close());
  summary();
});
