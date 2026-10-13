# Kings codebase audit — status

The audit of 13 Oct 2026 found about 240 issues (3 critical, 10 high, ~65 medium,
~170 low). All of them have been worked through; the full original report is in
git history (`git log -- AUDIT.md`).

## Done

- **13 Oct:** every critical and high issue: seat ownership, server-checked PINs,
  admin-only seasons and players, the admin passcode, live-sheet validation,
  tournament reconnects, photos as cacheable links, and most of the dead code.
- **14 Oct:** every medium and low issue, in six areas:
  - **Game server, API, database:** score-sheet rule checks, rate limits, the
    prikup hidden from the leader during trump selection, restart safety,
    tournaments saved and restored, tournament games out of the daily quota,
    lobby broadcasts to a `lobby` room, versioned resyncs, and `handlers.js`,
    `GameManager.js` and `store.js` split into modules.
  - **King Online client:** reconnects, offline taps, per-room state resets,
    wake lock, results/history card totals from one tally, and `GameContext.jsx`
    split into a reducer, event modules and four contexts.
  - **Phaser table:** layered redraws instead of rebuilding everything, baked
    textures, idle frame-rate drop, no tween leaks, `GameScene.js` split into
    views, and one set of card rules shared with the server
    (`server/game/rules.js`).
  - **King Score:** idempotent saves, a fixable final round, whole-number counts,
    one season rule, a faster first screen, lazy-loaded pages, and charts that
    follow dark mode and season themes.
  - **Stylesheets:** `index.css` split into per-screen partials, dead and
    overridden rules removed, phone layouts and contrast fixed, a 512 px icon.
  - **One copy of the shared logic:** game types (`server/game/gameTypes.js`),
    results, ties and season tables (`server/games/results.js`), achievements,
    win probability, totals and clock formatting (`shared/`). King Online now
    uses the same recharts and lucide versions as King Score.

## Left as is, on purpose

| Item | Why |
|---|---|
| S14 — a profile without a PIN can be edited by anyone | By design: a PIN is what protects a profile; deleting players is admin-only. |
| P-L16 — Phaser bundle size | Uses Phaser's prebuilt arcade bundle (~10% smaller); a custom build from `phaser/src` would need build flags and a maintained module list. |
| P-L20 — fonts via a Google Fonts stylesheet | `next/font` renames the font families, which the canvas and chart text draw by name. The stylesheet now asks for the right weights with `display=swap`. |
| C-L42 — a player named like "A & B" | Winners are read from the `winners` array everywhere; only the stored season champion string still joins names with " & ". |
| P6 — chat bubbles travel in the canvas state | The table now redraws only the bubble layer when chat changes, so it no longer costs a full redraw. |
