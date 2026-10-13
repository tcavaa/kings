// Turbopack loader for the custom Phaser build (src/online/game/phaser.js).
//
// Phaser's source switches features with `if (typeof WEBGL_RENDERER)` and
// expects the bundler to replace each whole `typeof FLAG` with true or false.
// webpack does that through compiler.define, but Turbopack's define can't
// replace a `typeof` expression: it leaves `typeof FLAG` as the string
// "undefined", which is truthy, so every optional feature (sound, the
// Facebook plugin, the WebGL debugger) would be bundled and switched on.
// This loader makes the same replacement in phaser/src files before
// Turbopack parses them. The flags come from next.config.mjs.
module.exports = function phaserFlagsLoader(source) {
  const flags = this.getOptions();
  const names = Object.keys(flags);
  if (names.length === 0) return source;
  const pattern = new RegExp(`typeof (${names.join('|')})\\b`, 'g');
  return source.replace(pattern, (_, name) => JSON.stringify(flags[name]));
};
