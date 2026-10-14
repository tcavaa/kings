# KING 3D mode

The desktop game offers a persistent 2D/3D switch. Three.js is loaded only when
3D is opened. Both renderers use the same GameContext, socket actions and shared
server card rules; switching views does not leave or restart a match.

## Controls

- Click a legal card to play. Disabled cards are dimmed.
- During discards, click two eligible cards and confirm on the tray.
- Choose the contract/trump on the physical tray, then confirm.
- Click the scorebook or the Scores button; S also opens it when the canvas has focus.
- Right-drag to look around; left/right arrow keys also turn the view. R resets it.
- The Controls panel exposes the same enabled actions as keyboard-focusable buttons.
- Existing chat, soundboard, reconnect banners, menu, quit votes and tournament
  controls continue to use the original React components.

The 3D room includes a seated POV, local hands, opponents holding hidden cards,
card dealing/play/trick collection, seated idle/head/arm movement, contract and
trump trays, discard selection, a paginated score ledger, and next-round control.
Reduced-motion preferences suppress decorative movement. The renderer releases
its GPU resources, animation loop and event listeners on switching back to 2D.

## Character replacement

The bundled six-character CC0 cast is assigned deterministically from room code
and seat, so clients agree and reconnects do not reshuffle it. Asset credits and
license are in `public/models/characters/`.

For a local replacement, open Characters, choose an opponent and select a head
or full-body GLB. Files must be GLB 2.0, at most 25 MB, with embedded textures and
buffers. External file references are rejected. Overrides persist in this
browser's IndexedDB, keyed by player name; they are not uploaded or shared with
other participants. Reset restores the bundled model.

Head assets: +Y up, front toward +Z, centered horizontally. The importer fits
them to the existing `head` or `Head` node. Default heads are separate meshes,
so they can be hidden. A third-party full body with a fused head needs a separate
head mesh or an asset-specific adapter; arbitrary face replacement cannot be
inferred reliably. Rigged head-only models are displayed but facial expression
retargeting is not implemented.

Full-body assets: +Y up, +Z forward, with a `sit`, `sitting`, or `seated` animation.
They are normalized to the cast's height; models with other skeleton names may
need a small adapter in `actors.js` for head/arm tracking and seat alignment.
Custom models without a sitting clip retain their authored pose. No automatic
retargeting service is used.

## Development and verification

`/dev/3d` is a development-only scene preview with phase buttons and simulated
local actions. It returns 404 in production and does not connect to a game server
or database. Use a real match for normal play.

`npm test` covers shared card rules, asset presence/rigs/animations, stable cast
assignment and uploaded GLB validation. Browser verification also exercises the
scene controls and the real GameLayout/GameContext with three Socket.IO clients
against an isolated in-memory instance of the existing server game engine.

The environment follows the emerald/walnut low-poly concept references, with
simpler placeholder characters. Custom face animation, voice lip-sync, shared
avatar uploads and exact art replication are not implemented.

To repeat the browser match test (Chrome must be installed), start an isolated
development server in one terminal:

```sh
NEXT_PUBLIC_SOCKET_URL=http://127.0.0.1:3101 npm run dev -- --port 3100
```

Then run `npm run test:3d` in another terminal. The test owns port 3101, creates
three isolated browser clients, stubs the unrelated REST endpoints, and uses the
real GameState engine without a database. It completes one Plus round through
all 30 card plays and checks the 2D/3D switch and next-round transition. Do not
point this test at production. The ordinary preview does not require this test
server.

Verified locally on 2026-10-14: 74 client/shared tests and 10 server tests passed;
production build passed; the development-only preview returns 404 in production;
character GLBs are served successfully. Browser checks passed for contract →
trump → discard → play, score pagination, spectator restrictions, next round,
real raycast mouse interaction, WebGL context-loss recovery, full-body/head GLB
imports, persistence and reset. Three isolated browser clients completed all 30
card plays in a Plus round through the real game engine and switched between
2D and 3D before advancing to the next leader. No production database records
were created or changed by these tests. This work has not been deployed.
