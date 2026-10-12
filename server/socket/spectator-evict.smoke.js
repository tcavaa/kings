'use strict';

// Watchers must be released when the table they are watching ends.
//
// Left attached, they show as permanently 'watching' a room that no longer
// exists, with no way back to the lobby and their chat relayed into a dead
// socket room.
//
// Run: PORT=3522 node socket/spectator-evict.smoke.js

process.env.PORT = process.env.PORT || '3522';
require('../index.js');

const path = require('path');
const { io } = require('socket.io-client');

const URL = `http://localhost:${process.env.PORT}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0;
const check=(n,c,e='')=>{ if(c){pass++;console.log('  ok  '+n);} else {fail++;console.error('FAIL  '+n+' '+e);} };
const mk = n => new Promise(res => {
  const s=io(URL,{transports:['websocket'],forceNew:true});
  s.n=n; s.online=[]; s.stopped=null;
  s.on('online-players', l => s.online = l);
  s.on('live-games', l => s.live = l);
  s.on('spectate-started', p => s.spectating = p);
  s.on('spectate-stopped', p => s.stopped = p || {});
  s.on('room-created', p => s.roomCode = p.roomCode);
  s.on('room-joined', p => s.roomCode = p.roomCode);
  s.on('connect', ()=>res(s));
});

(async () => {
  const [a,b,c,w] = [await mk('ევ-A'), await mk('ევ-B'), await mk('ევ-C'), await mk('ევ-მაყურ')];
  for (const s of [a,b,c,w]) { s.emit('announce-presence', { playerName: s.n }); await sleep(100); }
  a.emit('create-room', { playerName: a.n, mode: 'public' }); await sleep(400);
  b.emit('join-room', { roomCode: a.roomCode, playerName: b.n });
  c.emit('join-room', { roomCode: a.roomCode, playerName: c.n }); await sleep(400);
  a.emit('start-game'); await sleep(700);

  w.emit('watch-game', { roomCode: a.roomCode, playerName: w.n }); await sleep(600);
  check('watching started', !!w.spectating);
  check('presence says watching',
    w.online.find(p=>p.name==='ევ-მაყურ')?.status === 'watching');

  // End the game.
  a.emit('propose-quit', { kind: 'game' }); await sleep(250);
  b.emit('vote-quit', { accept: true }); c.emit('vote-quit', { accept: true });
  await sleep(1200);

  check('watcher was sent home when the game ended', !!w.stopped, JSON.stringify(w.stopped));
  check('and told why', w.stopped?.reason === 'game-over');
  w.emit('lobby-info'); await sleep(400);
  const me = w.online.find(p=>p.name==='ევ-მაყურ');
  check('presence no longer says watching', me?.status !== 'watching', JSON.stringify(me));
  check('presence points at no room', !me?.roomCode, JSON.stringify(me));
  check('the finished game is off the live list', (w.live||[]).length === 0, JSON.stringify(w.live));

  console.log(`\n${pass} passed, ${fail} failed`);
  [a,b,c,w].forEach(s=>s.close());
  process.exit(fail?1:0);
})();
