'use strict';

// Everything both apps read and write in the shared database, behind one
// require: the game server and the Next.js API routes both use
// `require('../db/store')`. Each domain lives in its own module:
//
//   profiles.js    profiles, photos, PINs, sessions, and ჩაწერა's player list
//   characters.js  each profile's 3D look (gender, uploaded head model)
//   games.js       finished games, lifetime stats, the daily league quota
//   seasons.js     King Score's seasons
//   live.js        rooms and tournaments in progress (restart recovery)
//   sheets.js      ჩაწერა score sheets being played right now
//   sounds.js      the reaction-clip catalogue
//   rateLimits.js  PIN and admin-passcode guess limits
//   mirror.js      the per-process table copies profiles.js and games.js read

module.exports = {
  ...require('./profiles'),
  ...require('./characters'),
  ...require('./games'),
  ...require('./seasons'),
  ...require('./live'),
  ...require('./sheets'),
  ...require('./sounds'),
  ...require('./rateLimits'),
};
