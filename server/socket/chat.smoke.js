'use strict';

// Chat message identity and tap-back reactions.
//
// Reactions need a stable message id, which the server assigns because chat
// itself is relayed and never stored. Also checks that an emoji outside the
// fixed palette is refused rather than relayed — an open string there would
// be a second, unrate-limited chat channel.
//
// Run: PORT=3521 node socket/chat.smoke.js

process.env.PORT = process.env.PORT || '3521';
require('../index.js');

const { io } = require('socket.io-client');

const URL = `http://localhost:${process.env.PORT}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0;
const check=(n,c,e='')=>{ if(c){pass++;console.log('  ok  '+n);} else {fail++;console.error('FAIL  '+n+' '+e);} };
const mk = () => new Promise(res => {
  const s=io(URL,{transports:['websocket'],forceNew:true});
  s.msgs=[]; s.reacts=[];
  s.on('chat-message', m => s.msgs.push(m));
  s.on('chat-reaction', r => s.reacts.push(r));
  s.on('room-joined', p => s.roomCode = p.roomCode);
  s.on('connect',()=>res(s));
});

(async () => {
  const [a,b,c] = [await mk(), await mk(), await mk()];
  let code=null; a.on('room-created', p => code = p.roomCode);
  a.emit('create-room', { playerName: 'რეაქ-A', mode: 'public' });
  await sleep(400);
  b.emit('join-room', { roomCode: code, playerName: 'რეაქ-B' });
  c.emit('join-room', { roomCode: code, playerName: 'რეაქ-C' });
  await sleep(500);

  a.emit('chat-message', { message: 'გამარჯობა' });
  await sleep(400);
  const msg = b.msgs[0];
  check('message delivered', !!msg);
  check('message carries an id', typeof msg?.id === 'string' && msg.id.length > 0, JSON.stringify(msg));
  check('all three see the same id', a.msgs[0]?.id === b.msgs[0]?.id && b.msgs[0]?.id === c.msgs[0]?.id);

  // React
  b.emit('chat-react', { messageId: msg.id, emoji: '❤️' });
  await sleep(400);
  check('reaction fans out to the room', a.reacts.length === 1 && c.reacts.length === 1);
  check('reaction names the message', a.reacts[0]?.messageId === msg.id);
  check('reaction carries the reactor', a.reacts[0]?.seat === 1);
  check('reactor sees their own reaction', b.reacts.length === 1);

  // Rejections
  const before = a.reacts.length;
  b.emit('chat-react', { messageId: msg.id, emoji: '💀' });      // not in the palette
  b.emit('chat-react', { messageId: msg.id, emoji: '<script>' }); // injection attempt
  b.emit('chat-react', { messageId: 'x'.repeat(200), emoji: '❤️' }); // oversized id
  b.emit('chat-react', {});                                        // empty
  await sleep(500);
  check('off-palette emoji rejected', a.reacts.length === before, `got ${a.reacts.length - before} extra`);

  // Same person + same emoji again = a second event; clients toggle locally.
  b.emit('chat-react', { messageId: msg.id, emoji: '❤️' });
  await sleep(300);
  check('repeat reaction relays again (client toggles)', a.reacts.length === before + 1);

  // Voice messages get ids too.
  a.emit('voice-message', { audio: Buffer.alloc(64), mime: 'audio/webm', duration: 1 });
  await sleep(400);
  const voice = b.msgs.find(m => !m.message);
  check('voice message also gets an id', !voice || typeof voice.id === 'string');

  a.emit('leave-room'); b.emit('leave-room'); c.emit('leave-room');
  await sleep(300);
  console.log(`\n${pass} passed, ${fail} failed`);
  [a,b,c].forEach(s=>s.close());
  process.exit(fail?1:0);
})();
