import { fileURLToPath } from 'node:url';

// Phaser's build flags, for the custom Phaser build the table imports
// (src/online/game/phaser.js). Phaser's source tests them as
// `if (typeof FLAG)`, so each `typeof FLAG` is replaced whole: true keeps a
// feature, false lets the minifier drop it. Same values as Phaser's own dist
// build, minus sound (the table plays its one sound through <audio>).
const PHASER_FLAGS = {
  CANVAS_RENDERER: true,
  WEBGL_RENDERER: true,
  WEBGL_DEBUG: false,
  EXPERIMENTAL: false,
  PLUGIN_3D: false,
  PLUGIN_CAMERA3D: false,
  PLUGIN_FBINSTANT: false,
  FEATURE_SOUND: false,
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  // King Online never ran under StrictMode (double-invoked dev effects would
  // open a second game socket); the score app opts in itself, exactly like
  // its old main.jsx did. Production behaviour is unaffected either way.
  reactStrictMode: false,
  // The API routes share the game server's CommonJS store (server/db), which
  // talks to Supabase through the postgres driver — keep it unbundled.
  serverExternalPackages: ['postgres'],
  // `next build --webpack`: webpack's define replaces `typeof FLAG` itself.
  compiler: {
    define: Object.fromEntries(
      Object.entries(PHASER_FLAGS).map(([flag, on]) => [`typeof ${flag}`, on]),
    ),
  },
  // Turbopack (the default): its define can't replace a `typeof` expression,
  // so a small loader does it in Phaser's source files instead.
  turbopack: {
    rules: {
      '*.js': {
        condition: { path: /(^|\/)node_modules\/phaser\/src\// },
        loaders: [
          {
            loader: fileURLToPath(new URL('./scripts/phaser-flags-loader.cjs', import.meta.url)),
            options: PHASER_FLAGS,
          },
        ],
      },
    },
  },
};

export default nextConfig;
