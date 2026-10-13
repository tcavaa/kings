'use strict';

// Homepage presence and public watching.
//
// Covers who shows as online (and that two tabs collapse to one person),
// which King tables are advertised as watchable, and the text-and-reactions-
// only limit that applies to a watcher who wandered in off the lobby rather
// than out of a tournament. Also audits that no card ever reaches them.
//
// Run: PORT=3520 node socket/lobby.smoke.js

process.env.PORT = process.env.PORT || '3520';
require('../index.js');

const { io } = require('socket.io-client');

const URL = `http://localhost:${process.env.PORT}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0;
const check=(n,c,e='')=>{ if(c){pass++;console.log('  ok  '+n);} else {fail++;console.error('FAIL  '+n+' '+e);} };
const mk = n => new Promise(res => {
  const s=io(URL,{transports:['websocket'],forceNew:true});
  s.n=n; s.online=[]; s.live=[]; s.errs=[]; s.chat=[]; s.voice=[]; s.sounds=[]; s.received=[]; s.watchers=null;
  s.onAny((e,p)=>s.received.push({e,p}));
  s.on('online-players', l => s.online = l);
  s.on('live-games', l => s.live = l);
  s.on('error', e => s.errs.push(e));
  s.on('chat-message', m => s.chat.push(m));
  s.on('voice-message', m => s.voice.push(m));
  s.on('play-sound', m => s.sounds.push(m));
  s.on('spectate-started', p => s.spectating = p);
  s.on('game-state', p => s.state = p);
  s.on('watchers', p => s.watchers = p.count);
  s.on('room-joined', p => s.roomCode = p.roomCode);
  s.on('room-created', p => s.roomCode = p.roomCode);
  s.on('hand-dealt', p => s.hand = p.hand);
  s.on('connect', ()=>res(s));
});

(async () => {
  const [a,b,c,w] = [await mk('პრეზ-A'), await mk('პრეზ-B'), await mk('პრეზ-C'), await mk('მაყურებელი')];

  // ── presence ──
  for (const s of [a,b,c,w]) { s.emit('announce-presence', { playerName: s.n }); await sleep(120); }
  await sleep(400);
  check('all four appear online', w.online.length === 4, JSON.stringify(w.online.map(p=>p.name)));
  check('everyone starts in the lobby', w.online.every(p => p.status === 'lobby'));

  // Two tabs, one person.
  const dup = await mk('პრეზ-A');
  dup.emit('announce-presence', { playerName: 'პრეზ-A' });
  await sleep(400);
  check('a second tab does not duplicate the person', w.online.length === 4, `${w.online.length}`);
  dup.close(); await sleep(300);

  // ── a live King game ──
  a.emit('create-room', { playerName: a.n, mode: 'public' });
  await sleep(400);
  b.emit('join-room', { roomCode: a.roomCode, playerName: b.n });
  c.emit('join-room', { roomCode: a.roomCode, playerName: c.n });
  await sleep(500);
  a.emit('start-game');
  await sleep(800);

  check('the game shows as watchable', w.live.length === 1, JSON.stringify(w.live.map(g=>g.roomCode)));
  const g = w.live[0];
  check('lists its players and scores', g?.players?.length === 3 && typeof g.players[0].score === 'number');
  check('reports the round', typeof g?.round === 'number');
  check('presence flips the trio to playing',
    w.online.filter(p => p.status === 'playing').length === 3,
    JSON.stringify(w.online.map(p=>p.name+':'+p.status)));

  // ── watch it ──
  w.received.length = 0;
  w.emit('watch-game', { roomCode: a.roomCode, playerName: w.n });
  await sleep(600);
  check('watching accepted', !!w.spectating, JSON.stringify(w.errs));
  check('watcher gets a masked state', w.state?.spectator === true);
  check('no hand in the masked state', (w.state?.hand || []).length === 0);
  check('table is told someone is watching', a.watchers === 1, `${a.watchers}`);
  check('watcher status shows as watching',
    w.online.find(p => p.name === 'მაყურებელი')?.status === 'watching');

  // ── text + emoji YES, voice + sound NO ──
  a.chat.length = 0; a.voice.length = 0; a.sounds.length = 0;
  w.emit('chat-message', { message: 'კარგი თამაშია' });
  await sleep(350);
  check('watcher CAN chat', a.chat.some(m => m.name === 'მაყურებელი'), JSON.stringify(a.chat));
  check('watcher chat flagged as spectator', a.chat.find(m=>m.name==='მაყურებელი')?.spectator === true);

  const msgId = a.chat.find(m=>m.name==='მაყურებელი')?.id;
  let gotReact = false; a.on('chat-reaction', () => { gotReact = true; });
  w.emit('chat-react', { messageId: msgId, emoji: '❤️' });
  await sleep(350);
  check('watcher CAN react with emoji', gotReact);

  w.emit('voice-message', { audio: Buffer.alloc(64), mime: 'audio/webm', duration: 1 });
  await sleep(350);
  check('watcher CANNOT send voice', a.voice.length === 0, `${a.voice.length} clips got through`);

  w.emit('play-sound', { soundId: 'yeehaw', targetSeat: 0 });
  await sleep(350);
  check('watcher CANNOT fire sound buttons', a.sounds.length === 0, `${a.sounds.length} sounds got through`);

  // Players are unaffected.
  a.emit('play-sound', { soundId: 'yeehaw', targetSeat: 0 });
  await sleep(350);
  check('players CAN still fire sounds', a.sounds.length === 1);

  // ── no card leaks to the public watcher ──
  const leaks = w.received.filter(({e,p}) =>
    (e === 'hand-dealt' || e === 'hand-updated') ||
    (Array.isArray(p?.hand) && p.hand.length) ||
    (Array.isArray(p?.centerCards) && p.centerCards.length) || p?.hands);
  check('NO cards leaked to the public watcher', leaks.length === 0, JSON.stringify(leaks.map(l=>l.e)));

  // ── guards ──
  a.errs.length = 0;
  a.emit('watch-game', { roomCode: a.roomCode, playerName: a.n });
  await sleep(300);
  check('a seated player cannot watch their own table', a.errs.length > 0);

  // ── stop ──
  w.emit('stop-watching');
  await sleep(400);
  check('table sees the watcher leave', a.watchers === 0, `${a.watchers}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  [a,b,c,w].forEach(s=>s.close());
  process.exit(fail?1:0);
})();
