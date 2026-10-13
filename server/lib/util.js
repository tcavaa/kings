'use strict';

// Small helpers shared by the game, tournament and socket code.

const crypto = require('crypto');

// Deals and room codes come from the OS's secure generator: Math.random's
// output can be predicted from a few samples. A test can swap in a seeded
// source (a function returning [0, 1), like Math.random) to replay a game.
let randomSource = null;

/** A whole number in [0, n). */
function randomInt(n) {
  return randomSource ? Math.floor(randomSource() * n) : crypto.randomInt(n);
}

/** Tests only: draw from `fn` instead of crypto (null restores crypto). */
function setRandomSource(fn) {
  randomSource = typeof fn === 'function' ? fn : null;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A 6-character room or tournament code, without look-alike characters. */
function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

/** Player names compare case-insensitively, ignoring surrounding spaces. */
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** A room mode from the wire: 'championship', or 'public' for anything else. */
const normalizeMode = (mode) => (mode === 'championship' ? 'championship' : 'public');

module.exports = { randomInt, setRandomSource, generateCode, sameName, normalizeMode };
