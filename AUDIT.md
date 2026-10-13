# Kings codebase audit — 13 Oct 2026

This audit covers the whole repo: both clients, the game server, the API, the database schema, styles, scripts and `public/`. 13 auditors read every source file, a separate reviewer tried to disprove each finding, and the survivors were merged into about 240 distinct issues. Links point at `file:line`.

## Fixed on 13 Oct 2026 (branch `audit-fixes`)

Every **critical** and **high** issue, the base64-photo problem, and nearly all of the dead code:

- **Seats and tournament entries are bound to their owner.** Each browser sends its own random key on connect, and verified profiles carry a server-issued session token. A name alone no longer reclaims a seat. (was S1, S11)
- **Profile PINs are checked on the server.** The game server refuses a PIN-protected name without the profile's session, and takes the name and photo from the profile. Wrong PINs are limited to 8 per 15 minutes. New and renamed profiles can't take an existing name. (was S4, S7, S8, S10, B6)
- **`POST /api/games` is gone.** The game server is the only writer and retries a failed save. (was S2)
- **Seasons and players are managed in `/admin`.** Ending a season (champion computed on the server, in a locked transaction), renaming and re-theming it, and adding/removing players or clearing a PIN. King Score only reads them, its End Season button and PIN are gone, and it no longer ships supabase-js. A migration locks `seasons` down. (was S3, C6, C28)
- **The admin passcode has no default**, needs 8+ characters, and wrong guesses are limited per IP and overall. (was S5)
- **Live sheets are validated** and rebuilt field by field. King Score's home screen also survives a bad sheet. (was S6, B12)
- **Tournament reconnects work.** A reconnect rebinds the entry, rejoins the bracket and re-seats the player at their live table. The game-over timer is cancellable. `leave-room` during a game keeps the seat. Finished tournaments are cleaned up. (was B1, B2, B8, C1, C2, C10, C11, D3, D4)
- **The leaderboard no longer hides your game**, and in-game round scores are readable. (was C3, C4)
- **Profile photos are cacheable links** (`/api/profiles/:id/avatar?v=…`) everywhere: lobby lists, chat, snapshots, saved games, the profile list. The leaderboard downloads games without photos. (was P1, P3, P4)
- **Dead code:** about 1 MB of unused `public/` files, the unused felt image preload, about 470 lines of dead CSS, the Vite leftovers, the old MySQL schema, unused routes, files, exports, imports and dependencies (`@supabase/supabase-js`, `cors`). (was X1, X2 and most of X-L)
- A failed first King Score load is no longer cached forever. (was C19)

**Needs doing outside the code:** set `ADMIN_PASSCODE` on Vercel (it isn't set today, so `/admin` stays locked until it is), apply `supabase/migrations/20261013120000_lockdown.sql` to the production database, and deploy both Vercel and Render.

## What's left

All remaining issues are **medium** or **low**. The most valuable next steps:

| Issue | Where |
|---|---|
| A player who leaves for good freezes the table: surrender needs all 3 votes, and only seat 0 can start the next round (B3) | [server/socket/handlers.js:671](server/socket/handlers.js:671) |
| Tournaments live only in memory, so a restart orphans the bracket (B10) | [server/tournament/TournamentManager.js:27](server/tournament/TournamentManager.js:27) |
| Lobby lists are still broadcast to everyone on every presence change (P2) | [server/socket/handlers.js:1172](server/socket/handlers.js:1172) |
| The Phaser table is rebuilt on every state update, and trump-sparkle tweens leak (P5, P6) | [src/online/game/scenes/GameScene.js:354](src/online/game/scenes/GameScene.js:354) |
| Results screen and history disagree on card totals; the achievement engine exists twice (C18, D1, D8) | [src/online/components/GameOverScreen.jsx:113](src/online/components/GameOverScreen.jsx:113) |
| Big files to split: `GameContext.jsx`, `handlers.js`, `GameScene.js` (D6, D7, D9) | — |
| No rate limits on chat, sounds and reactions (S12) | [server/socket/handlers.js:586](server/socket/handlers.js:586) |

## Security & data integrity
The identity and authentication holes are fixed (see the top). What's left is narrower: score-sheet games still aren't checked against the rules, chat and sounds have no rate limits, the leader sees the prikup during trump selection, and a profile without a PIN is, by design, open to anyone.

### S9. Score-sheet games are saved as championship results with no rule checks · Medium
**Where:** [server/games/scoreSheet.js:130](server/games/scoreSheet.js:130), [server/games/scoreSheet.js:152](server/games/scoreSheet.js:152), [app/api/games/live/route.js:7](app/api/games/live/route.js:7)
**Problem:** `POST /api/games/live` has no auth. `fromScoreSheet` accepts `rounds: []`, which gives finals of [0,0,0] and makes everyone a winner. It also accepts any per-round score up to ±1000 regardless of game type. Counts and targets are range-checked but never compared with the scores, and `buildRow` hard-codes `isChampionship: 1`. Anyone who knows three profile ids (public through `/api/players`) can store a one-round "+1000" game that counts in both apps' leaderboards, seasons and achievements. Once issue 2 is fixed, this is the only remaining way to post a forged game.
**Fix:**
- Require `rounds.length === players.length * 9`, and require each `(leaderPlayerId, gameTypeCode)` pair to appear exactly once.
- Recompute each round's scores from `countsByPlayerId` and `singleTargetPlayerId`, using a CommonJS copy of `computeScoresForRound` (src/score/utils/scoring.js). Reject the sheet on any mismatch, or store the computed scores instead.
- Optionally add a light write credential, such as a per-sheet token issued when the live sheet starts.
*Found by 3 auditors.*

### S12. No rate limits on sounds, chat or lobby-wide broadcasts · Medium
**Where:** [server/socket/handlers.js:584](server/socket/handlers.js:584), [server/socket/handlers.js:768](server/socket/handlers.js:768), [server/socket/handlers.js:930](server/socket/handlers.js:930)
**Problem:** Only `voice-message` is throttled. A seated player or tournament watcher can emit `play-sound` every 10 ms, and every client at the table restarts the clip 100 times a second. Any spectator can flood `chat-message` and `chat-react`, pushing real messages out of the 50-message window. `announce-presence`, `watch-game`, `stop-watching` and the tournament events each trigger an `io.emit` of the full lobby lists, avatars included, to every socket. One client looping these events multiplies traffic by the number of connected users. `targetSeat` also accepts any number.
**Fix:**
- Add a small per-socket token bucket in the connection closure, next to `lastVoiceAt` (line 742), and return early when it is empty. Suggested limits: sounds 3 per 5 s, chat 5 per 5 s, reactions 10 per 5 s, typing 1 per 2 s, and a few per 5–10 s for presence, watch and tournament events. Check `join-room` against its bucket before `tryLoadFromDB`.
- Debounce `_broadcastLobby` and `_refreshLobby` (about 250 ms, trailing) so a burst of events becomes one `io.emit`.
- Accept `targetSeat` only as an integer from 0 to 2.
*Found by 2 auditors.*

### S13. The leader receives the prikup during trump selection · Medium
**Where:** [server/game/GameState.js:585](server/game/GameState.js:585)
**Problem:** In the Pluses, the rules have the leader pick trump before seeing the two centre cards, and `selectGameType` deliberately delays the merge for that reason. But `getStateForPlayer` hides `centerCards` from the leader only during `type_selection`. During `trump_selection`, every `game-state` the leader receives carries both prikup cards to their browser. That includes reconnects, `request-state` calls from the focus and turn watchdogs, and a manual emit from devtools. The honest client doesn't draw the cards, but a curious leader can read them before choosing trump.
**Fix:** Change the condition to `isLeader && (this.phase === 'type_selection' || this.phase === 'trump_selection') ? [] : this.centerCards`. Update the doc comment at line 573, and add a test that the leader's `centerCards` stays empty between `selectGameType(<Pluses>)` and `selectTrump`.

### S14. Anyone can delete, rename or PIN-lock a profile that has no PIN · Medium
**Where:** [app/api/players/[id]/route.js:9](app/api/players/[id]/route.js:9), [server/db/store.js:34](server/db/store.js:34), [server/db/store.js:162](server/db/store.js:162), [src/online/lib/api.js:4](src/online/lib/api.js:4)
**Problem:** No ჩაწერა player has a PIN, and all ids are public through `GET /api/players`. A script calling `DELETE /api/players/:id` for each id empties the shared player list: the games survive, but the profiles are gone. `assertPinOwner` returns early when a profile has no PIN, so `PUT /api/profiles/<id> {name, pin:'1234'}` renames any PIN-less profile and locks it. After that, ჩაწერა can't remove the player (`deletePlayer` returns 403), and undoing it takes SQL. The client sends `X-Device-Key` on every write, and the comment at api.js:4 says the server uses it to scope edits. In fact the server only stores `device_key` and never compares it. PIN-less profiles are open partly by design, which is why this is rated Medium and not higher.
**Fix:**
- When a PIN is set on a profile that had none, refuse a name change in the same request, so claiming a profile can't also rename it.
- Add an admin action behind `requireAdmin` that clears a profile's PIN. Either put `DELETE /api/players/:id` behind it as well, or make that delete a soft delete.
- Correct the comment at api.js:4, or remove the unused `device_key` code: `deviceKey()` in lib/api/http.js:83 and the COALESCE writes in store.js.
*Found by 4 auditors.*

### Low-severity
| # | Issue | Where | Fix |
|---|---|---|---|
| S-L1 | `playCard` stores and rebroadcasts the client's own card object, so any extra fields (up to about 1 MB) reach the room, spectators and `live_games`. Found by 3 auditors. | [server/game/GameState.js:335](server/game/GameState.js:335) | Push the card taken from the hand (`const [played] = this.hands[seat].splice(handIdx, 1)`) and emit that in `card-played` (handlers.js:508). Require `rank` and `suit` to be strings. |
| S-L2 | `voice-message` accepts any object with a small `length`, which bypasses the 400 KB cap. `mime` can be any 64-character string. | [server/socket/handlers.js:748](server/socket/handlers.js:748) | Accept only `Buffer` or `ArrayBuffer` and measure `byteLength`. Allow only `audio/*` mime types. |
| S-L3 | Live-sheet ids are listed publicly and are the only credential, so anyone can overwrite or delete a sheet other people are following. The owner's next PUT restores it. Found by 3 auditors. | [app/api/live-sheets/[id]/route.js:17](app/api/live-sheets/[id]/route.js:17) | Issue a secret write key on the first PUT and store only its hash. Require the key on PUT and DELETE, and never return it from `listLiveSheets`. |
| S-L4 | Admin sound routes parse up to 6 MB of body before checking the passcode, and DELETE parses a body it never uses. The 6 MB limit is also above Vercel's 4.5 MB cap. Found by 3 auditors. | [app/api/admin/sounds/[id]/route.js:18](app/api/admin/sounds/[id]/route.js:18) | Call `requireAdmin` before `readJson` in every admin handler, and drop `readJson` from DELETE. Lower `UPLOAD_LIMIT` to about 3 MB. |
| S-L5 | `sendErr` returns raw Postgres and driver messages on 500, and path ids reach the database unchecked; for example, a 65-character profile id gives a 500 "value too long". Found by 2 auditors. | [lib/api/http.js:47](lib/api/http.js:47) | For status 500 and above, log the error and return a generic message. First tag the validation errors that store.js throws as 400. Map Postgres code 23505 to 409, and 22001 and 22P02 to 400. |
| S-L6 | The deck shuffle and room codes use `Math.random`, which is predictable. | [server/game/Deck.js:26](server/game/Deck.js:26) | Use `crypto.randomInt` here and in `generateCode` (GameManager.js:10). Pass the random function in, so fullgame.smoke.js can stay deterministic. |
| S-L7 | The PIN prompt shows the PIN in clear text on a shared screen. | [src/online/components/PinPromptModal.jsx:160](src/online/components/PinPromptModal.jsx:160) | Use `type="password"` as ProfileForm does, or draw dots based on `pin.length`. |


---

## Bugs — game server, API & database
Most of the game rules work. What's left is in the lifecycle code around them: restarts (tournaments live only in memory, simultaneous rejoins), a socket's room membership is never made exclusive, and one departed player can freeze a table. On the API/DB side, score-sheet saves aren't idempotent.

### B3. One departed player freezes the table · Medium
**Where:** [server/socket/handlers.js:671](server/socket/handlers.js:671), [server/game/GameManager.js:536](server/game/GameManager.js:536), [server/game/GameManager.js:556](server/game/GameManager.js:556)
**Problem:** If a seated player closes their tab mid-game, nothing ever acts for them.
- `vote-quit` needs `accepted.size === 3`, and a disconnected seat can never vote. The two remaining players cannot quit the round or surrender, and the proposal expires after 30 s.
- If seat 0 is the one who left at round end, `handleNextRound` rejects everyone else, who see 'ველოდებით წამყვანს…' forever.
- The game is never written to `finished_games`, and in a tournament (no forfeit) one no-show deadlocks the bracket.

**Fix:**
- In `propose-quit`/`vote-quit`, count disconnected seats as accepted (or require only connected seats). Re-check a pending proposal in the `disconnect` handler.
- In `handleNextRound`, accept the lowest connected seat when seat 0 is offline, and show the RoundResult button to that player.
- Later: add a per-turn deadline (~60 s), armed by `markDisconnected` for the seat GameState is waiting on, that auto-plays the first legal card or the first unused type.

*Found by 3 auditors.*

### B4. Simultaneous rejoins after a restart load the same room twice · Medium
**Where:** [server/game/GameManager.js:288](server/game/GameManager.js:288), [server/socket/handlers.js:202](server/socket/handlers.js:202), [server/index.js:63](server/index.js:63)
**Problem:** `tryLoadFromDB` checks `this.rooms` only before its `await`, then calls `rooms.set` without checking again. After a deploy, all three clients send `join-room` automatically within about a second. `hydrateAll` may still be running at that point, because the server starts listening without waiting for it.

Two loads can both miss the in-memory check. The first player joins copy A. The second load then replaces A with copy B, in which the first player still has the dead socket id and `connected:false`. Their next hand goes to the dead id, `markDisconnected` can't find them, and the room can be grace-deleted while they are still playing.

**Fix:**
- In `tryLoadFromDB`, keep a per-room Map of load promises that are still running, and return the existing promise when one is pending.
- After the `await`, `if (this.rooms.has(roomCode)) return this.rooms.get(roomCode)` before `rooms.set`.
- Optionally, store the `hydrateAll()` promise and await it in `join-room` (or before `server.listen`).

*Found by 4 auditors.*

### B7. A socket never leaves its previous room, so old-room events corrupt the current table and finished rooms leak · Medium
**Where:** [server/socket/handlers.js:1355](server/socket/handlers.js:1355), [server/game/GameManager.js:352](server/game/GameManager.js:352), [server/game/GameManager.js:412](server/game/GameManager.js:412), [server/game/GameManager.js:588](server/game/GameManager.js:588)
**Problem:** `createRoom` and `joinRoom` overwrite `socketRoomMap` without touching the old room. That covers `sitPublic`, `requestRematch` and the tournament draw too. The socket stays in the old socket.io channel, and its old player row stays `connected:true` forever.
- **Finals:** finalists stay subscribed to their semifinal. When an eliminated player there presses Home, `player-left` reaches the finalists, and `setPlayers` (GameContext.jsx:488) replaces the final table's names and avatars with the semifinal's. Chat, voice and sounds from that room leak through the same way.
- **Memory:** because the old row never goes offline, `armRoomGrace` never deletes the finished room after Play Again or a semifinal. Each one stays in memory until restart.
- **Quick match:** a waiting seat left behind this way becomes a ghost that can fill and start a table.

**Fix:**
- Add `GameManager.detachSocket(socketId, nextRoomCode)`. It:
  - calls `removeSpectator`;
  - if the mapping points at another room, removes the row when that room is `'waiting'` (clearing the quick-match pointer if the room empties), and otherwise sets `connected = false`;
  - arms grace if everyone in that room is offline;
  - returns the old room code.
- Call it from `createRoom`/`joinRoom` (skip same-room reconnects) and before `startTable`'s `socketsJoin`, then `io.in(id).socketsLeave(oldCode)`.
- In `armRoomGrace`, also delete rooms with status `'finished'`, whatever their `connected` flags say.
- Defensively, add `roomCode` to `player-left`/`player-reconnected`/`player-disconnected` and have the client ignore events for other rooms.

*Found by 3 auditors.*

### B9. Tournament games use up the 8-a-day championship quota · Medium
**Where:** [server/socket/handlers.js:1286](server/socket/handlers.js:1286), [server/db/store.js:677](server/db/store.js:677), [server/socket/handlers.js:212](server/socket/handlers.js:212)
**Problem:** Bracket tables are created as `'championship'` rooms. `_finishGame` saves them with `is_championship=1` and no tournament marker, and `getChampionshipQuota` counts every such row. The comment at line 212 says brackets must never "count against" the cap, but only the entry check skips them. A finalist loses 2 daily slots, and a player on 7 who then plays a semifinal and the final ends on 9 and is refused league tables.
**Fix:**
- Pass `tournamentId: room.tournamentId || null` to `store.saveFinishedGame`.
- Keep it in the saved payload, or in a new nullable `tournament_id` column.
- Skip those rows in `getChampionshipQuota`.

*Found by 4 auditors.*

### B10. Tournaments live only in memory, so a restart orphans the bracket · Medium
**Where:** [server/tournament/TournamentManager.js:27](server/tournament/TournamentManager.js:27), [server/index.js:63](server/index.js:63), [server/tournament/TournamentManager.js:228](server/tournament/TournamentManager.js:228)
**Problem:** Room snapshots keep `tournamentId` and `tournamentStage`, and `hydrateAll` restores the tables, but `TournamentManager` starts empty on every boot. After a Render deploy mid-bracket, the restored semifinals keep playing. At game over, `reportResult` finds no tournament and returns `'ignored'`, so no final is drawn and nobody is told. `request-rematch` also refuses, because the room still has a `tournamentId`. The comment at bracket.js:55 describes a rehydration step that doesn't exist.
**Fix:** Either:
- **Persist tournaments.** Add a `live_tournaments` table, saved on create, join, leave, draw, result and final, and deleted when done. Add a `TournamentManager.hydrateAll()` that runs after `gameManager.hydrateAll()` and before `listen`. Restored entries start disconnected and rebind by name.
- **Minimal fallback.** After `hydrateAll`, clear the tournament tags on rooms whose tournament is gone, so they finish as normal championship games.

Either way, correct the comment in bracket.js.

*Found by 3 auditors.*

### B11. Abandoned tournament lobbies never expire, and offline entrants are seated as connected · Medium
**Where:** [server/tournament/TournamentManager.js:155](server/tournament/TournamentManager.js:155), [server/tournament/TournamentManager.js:68](server/tournament/TournamentManager.js:68), [server/game/GameManager.js:336](server/game/GameManager.js:336)
**Problem:** `markDisconnected` only sets `connected = false`; nothing ever removes an entrant or a lobby. A creator who closes the tab leaves a joinable "1/6" lobby in every client's list until the next restart.

If a lobby fills while an entrant is offline, `_openTable` seats them under the dead socket id, and `createRoom`/`joinRoom` mark them `connected:true`. The table shows them as online, nobody receives their hand, and the game waits on them forever. The disconnect handler also never calls `_tournamentSync`, so the roster's offline flag is never sent to clients.

**Fix:** In the disconnect handler, when the tournament is still in `'lobby'`:
- arm a ~60 s timer that removes the entrant if they are still offline;
- delete the lobby once it has no connected players;
- then call `_tournamentSync` and re-broadcast `tournament-list`.

*Found by 2 auditors.*

### B14. Spectators evicted when an empty room's grace window expires aren't told · Medium
**Where:** [server/game/GameManager.js:591](server/game/GameManager.js:591)
**Problem:** When everyone at a table drops and the 90 s grace window expires, `armRoomGrace` deletes the room and evicts its watchers silently: they get no `spectate-stopped` and sit on a frozen table. (Watchers evicted at game over now also leave the room's socket channel.)
**Fix:** Have the grace expiry hand the evicted ids back to the socket layer, which sends them `spectate-stopped` and makes them leave the room channel.

### B15. Spectators never get the per-round reset · Medium
**Where:** [server/socket/handlers.js:567](server/socket/handlers.js:567), [src/online/context/GameContext.jsx:609](src/online/context/GameContext.jsx:609)
**Problem:** Players reset card counts, game type, trick tally and center cards in the `hand-dealt` handler, but `hand-dealt` is sent only to seated players. Watchers get `round-started`, which carries no `cardCounts` and whose client handler doesn't reset `chosenGameType` or `tricksTaken`. So during the type, trump and discard phases of every new round, watchers see last round's card counts (usually 0, so no opponent card fans), the old game type and the old trick count.
**Fix:**
- Add `cardCounts` (computed from `gameState.hands`) to the `round-started` payload.
- In the client handler, set `cardCounts` and reset `tricksTaken`, `chosenGameType` and `centerCards`.

Players get `hand-dealt` right after `round-started`, so these resets are harmless for them.

### Low-severity
| # | Issue | Where | Fix |
|---|---|---|---|
| B-L1 | `player-left` sends a roster without avatars, so every remaining photo in the waiting room falls back to the default until the next join (4 auditors). | [server/socket/handlers.js:1156](server/socket/handlers.js:1156) | Send `players: playersView(room.players)`. |
| B-L2 | Spectators get the quit/surrender vote dialog. A watcher who was seat 0 in an earlier game also sees the next-round button; clicking either only produces error toasts. | [server/socket/handlers.js:638](server/socket/handlers.js:638) | Render `QuitModal` only when `!isSpectator` (GameLayout.jsx:362). Use `isCreator && !spectating` in RoundResult.jsx:66. Call `setIsCreator(false)` on `spectate-started`. |
| B-L3 | `select-trump` bypasses GameManager, so the trump choice and the prikup merge are never saved; a restart before the discard rewinds to trump selection (2 auditors). | [server/socket/handlers.js:449](server/socket/handlers.js:449) | Add `GameManager.handleSelectTrump` that calls `_persist` on success, and call it from the handler. |
| B-L4 | A quit round's details keep the partial card counts and K-target, which contradict the flat quit scores and skew lifetime stats and ჩაწერა history. | [server/game/GameState.js:487](server/game/GameState.js:487) | Store null counts and target when `quitBySeat` is set, or have consumers skip quit rounds. |
| B-L6 | If the `live_games` delete at game over fails, the next boot restores the finished game as live. | [server/game/GameManager.js:460](server/game/GameManager.js:460) | Retry the delete with backoff. In `hydrateAll`, drop `round_end` snapshots at round ≥ 27. |
| B-L7 | Restored quick-match waiting rooms are invisible because `quickMatchCodes` isn't restored. No restored room gets a grace timer, so ghost rooms stay in memory (2 auditors). | [server/game/GameManager.js:319](server/game/GameManager.js:319) | Skip public waiting rooms in `hydrateAll`, and call `armRoomGrace` for every restored room. |
| B-L8 | Double taps on type, trump, discard, next round, start or Play Again show error toasts in English. A second Play Again tap resolves to the new room ('Game is not finished yet.') (2 auditors). | [server/socket/handlers.js:419](server/socket/handlers.js:419), [server/game/GameManager.js:713](server/game/GameManager.js:713) | Add a per-action pending flag on the client. On the server, return silently when the phase has already moved on, and make rematch idempotent. |
| B-L9 | `disconnect` broadcasts `live-games` before marking the player offline, so dead tables stay listed. The tournament roster's offline flag is never pushed. | [server/socket/handlers.js:1173](server/socket/handlers.js:1173) | Broadcast after `markDisconnected`, and call `_tournamentSync` afterwards. |
| B-L10 | The bracket overview shows 0/0/0 for semifinal tables whose room was freed, and a blank final once its room is freed. | [server/tournament/TournamentManager.js:318](server/tournament/TournamentManager.js:318) | Fall back to `recorded.result.players`. Record the final's result and pass it to `tableView`. |
| B-L11 | Joining a quick-match table by code via `join-room` never auto-starts it at 3/3, which jams the homepage table. | [server/socket/handlers.js:222](server/socket/handlers.js:222) | Refuse new names at public waiting rooms in `join-room`, or share a `maybeAutoStart` helper. |
| B-L12 | There is no SIGTERM handler, so snapshot writes still queued are dropped on a redeploy. | [server/index.js:67](server/index.js:67) | On SIGTERM, close io, flush the store's per-room queues with a timeout, then exit. |
| B-L13 | The championship quota is only checked at seating time. Two tabs, or Play Again before the save lands, can exceed it. | [server/socket/handlers.js:847](server/socket/handlers.js:847) | Count in-progress championship seats. Await the room's save promise before the rematch quota check. |
| B-L14 | Public-seat sweep timers are never tracked or cancelled, so a second drop can be swept after 5 s. The sweep doesn't persist. | [server/socket/handlers.js:1185](server/socket/handlers.js:1185) | Keep the timer on the player row and clear it on reconnect. Check the captured player, and call `_persist` after the sweep. |
| B-L15 | `deletePlayer`/`deleteProfile` check the PIN, then delete in a separate statement. | [server/db/store.js:224](server/db/store.js:224), [server/db/store.js:181](server/db/store.js:181) | Use a single compare-and-delete (`... AND pin_hash IS NULL RETURNING id`). |
| B-L16 | `POST /api/games/live` accepts an empty or partial sheet; `rounds: []` makes every player a winner. | [server/games/scoreSheet.js:130](server/games/scoreSheet.js:130) | Require `rounds.length === players.length * GAME_TYPES.length`. |
| B-L18 | Smoke tests start the real server against `DATABASE_URL` and write fake championship games. `server/.env` points at localhost today, so this is a latent risk. | [server/tournament/socket.smoke.js:10](server/tournament/socket.smoke.js:10) | Refuse a non-local `DATABASE_URL` unless `TEST_DATABASE_URL` is set. |
| B-L19 | Some smoke assertions can't fail: the voice check reads `chat-message`, and `nextLeader`/`last-trick` don't exist. | [server/socket/chat.smoke.js:73](server/socket/chat.smoke.js:73) | Listen for `voice-message` and assert on it. Fix the field names in spectate.smoke.js. |


---

## Bugs — King Online & King Score clients (incl. CSS)
The serious King Online bugs (game-over timer, tournament reconnects, the leaderboard hiding the game, stale room codes) are fixed. What's left in `GameContext.jsx` is state that still isn't tied to a room (`finalResults`, chat, `selectedDiscards`) and a few reconnect edge cases. King Score's bugs are mostly data-integrity edge cases: duplicate saves, a season race, invalid rounds getting saved, and a failed load that stays cached. The CSS bugs are mostly poor contrast inside the cream in-game sheets.

### C9. After a tournament starts or ends, the lobby's tournament panel is stuck · Medium
**Where:** [src/online/components/Tournament/TournamentPanel.jsx:37](src/online/components/Tournament/TournamentPanel.jsx:37), [src/online/context/GameContext.jsx:451](src/online/context/GameContext.jsx:451), [server/socket/handlers.js:1394](server/socket/handlers.js:1394)
**Problem:** The client's `tournament` state never gets out of its pre-draw snapshot:
- It is cleared only by `tournament-left`, which the server sends only when someone leaves before the draw.
- After the draw, the server never sends `tournament-state` again.
- `tournament-complete` does not reset it, and the server never destroys the tournament.

An eliminated player or the champion who goes back to the lobby sees a full bracket with "მაგიდები მზადდება…" and no leave button. They cannot create or join another tournament until a full reload; the server also keeps answering "You are already in a tournament."
**Fix:**
- **Server, `tournamentComplete`:**
  - Emit `tournament-state` with status 'done'.
  - Call `io.in(t.id).socketsLeave(t.id)` and destroy the tournament after a delay.
  - Make `findBySocket` skip finished tournaments.
- **Client:** on `tournament-complete`, mark the tournament done, or clear `tournament`, `tournamentOverview` and `tournamentFinal` when the result is dismissed.
- **Panel:** branch on `tournament.status`:
  - 'lobby': the current view.
  - 'semifinal' or 'final': an "in progress" message and a bracket button.
  - 'done': the winners and a "new tournament" button that clears the local state.

### C12. Reconnecting at a homepage quick-match table moves the user into the WaitingRoom · Medium
**Where:** [src/online/context/GameContext.jsx:379](src/online/context/GameContext.jsx:379), [server/socket/handlers.js:354](server/socket/handlers.js:354)
**Problem:** `public-seated` sets `roomCodeRef`, so after a blip the connect handler sends `join-room` instead of `rejoin-public`. The server replies `room-joined {reconnected:true, status:'waiting'}` and the client sets appPhase to 'waiting'.

That moves the user off the homepage into a private-style WaitingRoom. Its Leave button emits `leave-room`, not `stand-public`, so no `public-room` broadcast goes out and other visitors keep seeing the seat as taken.
**Fix:**
- In the connect handler, when `publicSeatRef.current !== null`, emit `rejoin-public { roomCode, playerName }` instead of `join-room`. It already handles both waiting and started rooms.
- Clear `reconnecting` in the `public-seated` and `public-rejoin-failed` handlers.
- On the server, broadcast `public-room` from `leave-room` whenever a waiting public room changes.

### C13. Taps made while offline reach the server before the rejoin and are rejected · Medium
**Where:** [src/online/context/GameContext.jsx:1302](src/online/context/GameContext.jsx:1302), [src/online/context/GameContext.jsx:1294](src/online/context/GameContext.jsx:1294), [src/online/context/GameContext.jsx:1170](src/online/context/GameContext.jsx:1170)
**Problem:** `playCard`, `discardCards`, `selectGameType`, `selectTrump`, `nextRound` and `sendChat` emit without checking the connection. socket.io-client buffers these emits and flushes the buffer before the `connect` handler runs, so they reach the server before `join-room` rebinds the new socket id.

The server answers "You are not in a room." (an English toast), and:
- a played card only comes back through the error-path resync,
- discards are cleared locally but never applied,
- chat typed while offline is silently dropped.
**Fix:** Two options.
- **Preferred, server-side:** send the rejoin identity in the handshake (`auth: { roomCode, playerName }`) and rebind the socket on the server before any queued packet is handled.
- **Client-only:**
  - Refuse actions while `!socket.connected || reconnecting`, and disable the hand and controls while the reconnect banner shows.
  - Queue chat until `room-joined {reconnected:true}`.

### C14. Chat and the "player disconnected" banner leak into the next room · Medium
**Where:** [src/online/context/GameContext.jsx:1307](src/online/context/GameContext.jsx:1307), [src/online/context/GameContext.jsx:988](src/online/context/GameContext.jsx:988)
**Problem:** None of `leaveRoom`, `room-created`, `room-joined`, `game-started` or the spectate handlers reset `chatMessages`, `chatBubbles`, `typingSeats`, `disconnectedPlayer` or `quitProposal`.
- **Chat:** room A's chat, including voice clips whose blob URLs are never revoked, still shows in room B or while watching another table.
- **Disconnect banner:** if an opponent closes their tab while you are still on the results screen, '… გაითიშა — ველოდებით მის დაბრუნებას…' is set. Only `player-reconnected` clears it, so it stays up through the rematch and later games.
**Fix:**
- Add a `resetRoomScopedState()` helper that:
  - revokes the voice URLs,
  - clears chat, bubbles, typing and their timers,
  - clears `disconnectedPlayer` and its grace timer (lift that timer into a ref),
  - clears `quitProposal`, `lastTrickResult` and `selectedDiscards`.
- Call it from `leaveRoom`, `room-created`, `room-joined` when it isn't a reconnect, `spectate-started`, `spectate-stopped` and `public-unseated`.
- Also clear `disconnectedPlayer` in `game-started`.

### C15. `finalResults` is never cleared, so a missed game-over shows the previous game's results · Medium
**Where:** [src/online/context/GameContext.jsx:1014](src/online/context/GameContext.jsx:1014), [src/online/context/GameContext.jsx:558](src/online/context/GameContext.jsx:558)
**Problem:** Nothing ever calls `setFinalResults(null)`. The `game-state` handler rebuilds results from a finished snapshot only when none are stored (`if (prev) return prev`).

Example: a player finishes game 1 and plays again. Their phone is locked when game 2 ends, so they miss its `game-over`. When they reconnect into the finished room, they see game 1's winners, scores and confetti.
**Fix:**
- Call `setFinalResults(null)` in `game-started`, in `leaveRoom`, and on `room-joined` for a different room.
- Store `roomCode` with the results, and keep `prev` only when it matches `roomCodeRef.current`.

### C16. Spectators get the quit/surrender vote dialog · Medium
**Where:** [src/online/components/Hud/QuitModal.jsx:24](src/online/components/Hud/QuitModal.jsx:24), [src/online/components/GameLayout.jsx:362](src/online/components/GameLayout.jsx:362)
**Problem:** Watchers are in the room's socket.io channel, so they receive `quit-proposal`. With `mySeat === null`, both `isMine` and `iAccepted` are false, and QuitModal shows the blocking vote dialog with Agree/Refuse. The dialog cannot be dismissed and stays up until the vote resolves or 30 s pass. Voting gets "You are not in a room."

MenuDrawer already hides the quit actions from spectators, but QuitModal is never told the viewer is a spectator.
**Fix:**
- Pass `spectator={isSpectator}` to QuitModal.
- When `spectator || mySeat == null`, render only the passive "waiting for votes" pill and never the confirm dialog.
- Optionally, make `voteQuit` and `proposeQuit` do nothing while spectating.

### C17. "Play again" is offered after tournament games and always fails · Medium
**Where:** [src/online/components/GameOverScreen.jsx:238](src/online/components/GameOverScreen.jsx:238), [server/socket/handlers.js:841](server/socket/handlers.js:841)
**Problem:** GameOverScreen never checks whether the game was a tournament game or whether the viewer is a spectator. Every eliminated semifinalist and every finalist sees an active 'კიდევ ერთი თამაში' button. The server always rejects it with "Tournament games cannot be replayed." as an English toast. Spectators who land here through #1 see the same button and get "You are not in a room."
**Fix:**
- Read `tournamentSeat` and `spectating` in ResultsContent.
- For those players, hide the rematch button and its note, and show a "back to tournament/lobby" action that calls `leaveRoom` instead.
- Fixing #1 keeps spectators off this screen.

### C18. Game-over stats overcount queens, jacks, hearts and K♥ · Medium
**Where:** [src/online/components/GameOverScreen.jsx:113](src/online/components/GameOverScreen.jsx:113), [src/online/components/LeaderboardPanels/GameDetail.jsx:64](src/online/components/LeaderboardPanels/GameDetail.jsx:64)
**Problem:** The server records queen, jack and heart counts and the K♥ taker in every round's detail, whatever the contract.
- GameOverScreen sums them over all rounds.
- GameDetail and `store.getLifetimeStats` count each one only in its matching round (Q, J, H or K).

So every finished game shows inflated 'აღებული დამები / ვალეტები / გულები / კინგი' numbers. The K♥ count can be far above the real maximum of 3, and the same game shows different numbers in the leaderboard.
**Fix:**
- Guard each line with the round type: `if (d.gameType === 'Q') …`, and the same for J, H, and K for K♥.
- Ideally, move the tally into one shared helper used by both GameOverScreen and GameDetail.

*Found by 2 auditors.*

### C20. Fractional card counts pass the client but make the game unsaveable · Medium
**Where:** [src/score/components/GameTypeSelector.jsx:67](src/score/components/GameTypeSelector.jsx:67), [src/score/components/ScoreTable.jsx:82](src/score/components/ScoreTable.jsx:82), [server/games/scoreSheet.js:133](server/games/scoreSheet.js:133)
**Problem:** The count inputs store `Math.max(0, Number(value))` with no integer check, and validation only checks the sum. Entering 1.5 and 2.5 for Queens adds up to 4, so the round is accepted. At game end, the server's `Number.isInteger` check rejects the whole game with "Invalid round counts."

Only the last round can be edited, and not at all once the game is finished (see #21). So the user has to undo back to the bad round or reset the sheet.
**Fix:**
- Parse with `Math.trunc` at input time in both places.
- Add `step="1"` to both inputs.
- Check `Number.isInteger` for every count in one shared helper used by GameTypeSelector and ScoreTable.

### C21. The final round can't be undone or edited once the game is finished · Medium
**Where:** [src/score/App.jsx:385](src/score/App.jsx:385)
**Problem:** Entering the last round switches to the finished view, and that view's ScoreTable gets neither `onEditLastRound` nor `onUndoLastRound`. A typo in the final round leaves two choices:
- save a wrong game to the shared database, where it feeds stats, winners and the season champion, or
- reset the whole sheet.

The reducer's "undoing the final round un-finishes the game" branch can never run.
**Fix:** Pass `onEditLastRound={onEditLastRound}` and `onUndoLastRound={onUndoLastRound}` to the finished ScoreTable. Optionally disable both while `saving`.

### C22. Deleted King Score players still appear in stats, and a re-added name shows twice · Medium
**Where:** [src/score/lib/gameShapes.js:23](src/score/lib/gameShapes.js:23), [src/score/lib/gameData.js:35](src/score/lib/gameData.js:35)
**Problem:** Live games keep the `profileId` saved in their payload, and `liveGameToLegacy` uses it without checking that the profile still exists. After a player is removed:
- Their live games stay keyed by the dead id, so GlobalAnalyticsPage and the season table still list them; those screens only hide `guest:` ids.
- Their online games fall back to `guest:name`, so one person is split in two.

If the name is added again, there are two rows with the same name, and charts keyed by `p.name` overwrite each other.
**Fix:** Pass the set of current profile ids, and `idOfName`, into `liveGameToLegacy`. Use `profileId` only while it is still known; otherwise resolve by name, as online games already do.

### C23. Season champion and season standings use different rules · Medium
**Where:** [src/score/components/WinnersPage.jsx:22](src/score/components/WinnersPage.jsx:22), [src/score/components/SeasonChampionsTab.jsx:44](src/score/components/SeasonChampionsTab.jsx:44), [src/online/components/LeaderboardPanels/SeasonsPanel.jsx:142](src/online/components/LeaderboardPanels/SeasonsPanel.jsx:142)
**Problem:** Three places rank the same season three ways:

| Where | What it counts | Removed players | Season window |
|---|---|---|---|
| `determineChampion` | Every winner name in all live results, plus online championship wins | Kept | `> seasonStart` |
| King Score season table | Only live games that have detail rows (online-only players and old imported games without detail rows are missing) | Drops `guest:` ids | `>= start` |
| King Online's SeasonsPanel | `aggregatePlayers` | Skips `profileId === null` | `>= start` |

So the champion written to `seasons.champion_name` can be someone who is not top of either app's season table, or not listed in it at all.
**Fix:**
- Write one `seasonStandings(games, from, to)` and use it in `determineChampion`, `SeasonStats` and SeasonsPanel. It should use the same window and the same removed-player rule, and count games that have no detail rows.
- Drop the `online_name` lookup, which does nothing.

### C24. The screen wake lock is lost after the first time the tab is hidden · Medium
**Where:** [src/online/components/GameLayout.jsx:223](src/online/components/GameLayout.jsx:223)
**Problem:** The browser releases a screen wake lock whenever the page is hidden. `lock` still holds the released lock object, so `!lock` is false when the page comes back and the lock is never requested again. After a player switches apps or locks the phone once mid-game, the screen dims and sleeps on its normal timeout for the rest of the game.
**Fix:** Re-acquire when `!lock || lock.released`, or add a `release` listener in `acquire()` that sets `lock = null`.

### C25. King Score charts ignore dark mode and season themes · Medium
**Where:** [src/score/components/ScoreChart.jsx:7](src/score/components/ScoreChart.jsx:7), [src/score/components/GameAnalytics.jsx:13](src/score/components/GameAnalytics.jsx:13), [src/score/components/GlobalAnalyticsPage.jsx:15](src/score/components/GlobalAnalyticsPage.jsx:15), [src/score/styles/main.css:102](src/score/styles/main.css:102)
**Problem:** The dark-mode and theme variables are defined on `body.dark` and `body.theme-*`. The three chart components read them with `getComputedStyle(document.documentElement)`. Custom properties only inherit downward, so `<html>` always has the light `:root` values.

In dark mode:
- the zero line is near-black on a dark card, so it is invisible,
- the grid is bright,
- the axis labels keep the light-theme grey,
- the tooltip stays white.

The seasonal grid colours never apply either.
**Fix:**
- Read the variables from `document.body`, in one shared `getCssVar` helper.
- Re-read them when the theme changes: pass `darkMode` and the theme down as memo keys, or watch `body`'s class with a MutationObserver.
- Alternative: move the classes to `<html>` and change the selectors to `:root.dark` and so on.

### C26. Avatars on the upright-phone table are cropped to a small square · Medium
**Where:** [src/online/game/scenes/GameScene.js:553](src/online/game/scenes/GameScene.js:553), [src/online/game/scenes/GameScene.js:515](src/online/game/scenes/GameScene.js:515)
**Problem:** In portrait, the avatar container is scaled 1.4x. The geometry mask is drawn separately at the unscaled size, and Phaser does not apply the container's scale to masks. Every upright-phone player sees a small, centre-cropped photo inside a wide white frame.
**Fix:** Scale the mask rectangle by the same factor: `const s = this.L.portrait ? 1.4 : 1`, then multiply the offsets and sizes by `s`. Or position and scale the mask graphics together with the container.

### C27. On phones, the leaderboard's leader card squeezes the leader's name into a 70px column · Medium
**Where:** [src/online/styles/index.css:2303](src/online/styles/index.css:2303), [src/online/styles/index.css:2310](src/online/styles/index.css:2310), [src/online/components/Leaderboard.jsx:227](src/online/components/Leaderboard.jsx:227)
**Problem:** Under 760px, `.k-leader-feature` becomes a grid with a 70px column and a flexible column, and it expects the avatar and `<h2>` to be direct children. Leaderboard.jsx now wraps both in `button.k-feature-profile`. As a result:
- the button lands in the 70px column, and the second column stays empty,
- the 88px avatar overflows,
- the 24px name wraps every few characters.

The `> .rounded-full` rules no longer match anything.
**Fix:**
- Replace the dead rule with `.k-leader-feature > .k-feature-profile { grid-column: 1/-1; flex-direction: row; align-items: center; gap: 16px }`.
- Size the avatar with `.k-feature-profile .k-avatar { width: 64px !important; height: 64px !important }`.
- Delete or retarget the desktop `> .rounded-full` rule as well.

### Low-severity
| # | Issue | Where | Fix |
|---|---|---|---|
| C-L1 | Spectator resyncs (the 9 s watchdog and the tab-resume resync) send `request-state`, which the server answers only through the seat mapping. For homepage watchers it never resyncs. A tournament watcher who still maps to their finished semifinal gets that game's `game_over` snapshot and is sent to results. Today this is only reachable in #1's 2 s window, but fixing #1 makes it reachable. Found by 2 auditors. | [src/online/context/GameContext.jsx:216](src/online/context/GameContext.jsx:216), [server/socket/handlers.js:897](server/socket/handlers.js:897) | In `request-state`, check `gameManager.getSpectator(socketId)` first and reply with `getStateForSpectator()` for the watched room. |
| C-L2 | `round-complete` queues `setGamePhase('round_end')` even when `isGameOver`. RoundResult, with its next-round button, flashes for about 200 ms before the results screen, and a tap there errors. | [src/online/context/GameContext.jsx:753](src/online/context/GameContext.jsx:753) | Skip the round_end timer when `isGameOver`. |
| C-L3 | `selectedDiscards` survives a quit-round vote, so the leader's next discard dialog shows stale cards. The first confirm is rejected ('Card … not in hand.') and clears them, so it fixes itself after one English error. Found by 2 auditors. | [src/online/context/GameContext.jsx:1295](src/online/context/GameContext.jsx:1295) | `setSelectedDiscards([])` in `hand-dealt`, `round-complete`, `game-state` and `leaveRoom`. |
| C-L4 | A late trick-clear timer (e.g. throttled tab) can wipe the next trick's lead card and reset `currentTurn`. The watchdog or the next event repairs it. Found by 2 auditors. | [src/online/context/GameContext.jsx:704](src/online/context/GameContext.jsx:704) | In `card-played`, cancel pending trick timers and apply the deferred tricksTaken/trickNumber first. |
| C-L5 | A `game-state` snapshot can't clear values: truthiness checks skip `chosenGameType: null` and `lastTrick: null`, and `quitProposal` isn't in the snapshot. After a reconnect into a new round, the HUD keeps the old contract, last trick or vote dialog. Found by 2 auditors. | [src/online/context/GameContext.jsx:1043](src/online/context/GameContext.jsx:1043) | Assign by key presence (`'chosenGameType' in state`), use `state.lastTrick ?? null`, and include or clear `quitProposal` in snapshots. |
| C-L6 | One shared disconnect grace timer: two dropouts within 5 s show only the second, and any reconnect clears the banner even if the other player is still gone. | [src/online/context/GameContext.jsx:988](src/online/context/GameContext.jsx:988) | Keep a timer per name and a set of disconnected names; remove only the player who reconnected. |
| C-L7 | Voice clips drop the server message `id` (and `spectator`), so nobody can react to them. | [src/online/context/GameContext.jsx:905](src/online/context/GameContext.jsx:905) | Add `id: msg.id, spectator: !!msg.spectator` to the voice entry. |
| C-L8 | voicePlayer: switching clips while the first is still loading lets clip A's rejected `play()` clear clip B's state. B then shows as stopped, and the next tap restarts it. Found by 2 auditors. | [src/online/lib/voicePlayer.js:26](src/online/lib/voicePlayer.js:26) | Capture the element and reset state only `if (audio === el)`; detach handlers in `stop()`. |
| C-L9 | `player-left` sends the roster without avatars, and the client replaces the whole roster, so photos vanish in WaitingRoom. | [server/socket/handlers.js:1154](server/socket/handlers.js:1154), [src/online/context/GameContext.jsx:488](src/online/context/GameContext.jsx:488) | Use `playersView(room.players)` in the `player-left` emit. |
| C-L11 | The trick-winner pulse and the K♥ camera shake never run: the scene state has no `lastTrickResult`, so `_maybeReactToTrickWinner` always returns early. Found by 2 auditors. | [src/online/game/scenes/GameScene.js:370](src/online/game/scenes/GameScene.js:370) | Call `_pulseAvatarFor`/`_shakeOnKingOfHearts` from `_onAnimateTrickWinner`, or delete all three methods. |
| C-L12 | `aggregatePlayers` compares `p.score ?? 0` but assigns the raw `p.score`, so a missing score makes best/worst `undefined` for good. Not triggered today: only a hand-made POST to /api/games would do it. Found by 2 auditors. | [src/online/lib/leaderboard.js:46](src/online/lib/leaderboard.js:46) | `const s = Number(p.score) \|\| 0` and use `s` everywhere. |
| C-L13 | The contract, trump and next-round buttons don't lock after a tap, so a double tap sends twice and shows an English 'Not in type selection phase.' toast. | [src/online/components/GameTypeSelector.jsx:95](src/online/components/GameTypeSelector.jsx:95) | Add a local `submitting` state that disables the buttons after the first tap. |
| C-L14 | Double-tapping the mic starts two recorders; the first keeps the mic on and its timer running. | [src/online/components/ChatOverlay.jsx:139](src/online/components/ChatOverlay.jsx:139) | Set a `startingRef` before `getUserMedia` and ignore taps while it is set. |
| C-L15 | The results headline says 'ეს მომენტი შენია.' to losers and spectators too. | [src/online/components/GameOverScreen.jsx:157](src/online/components/GameOverScreen.jsx:157) | Branch on `winnerSeats.has(mySeat)`, with separate copy for losers and spectators. |
| C-L16 | RoundResult tells everyone else 'ველოდებით წამყვანს…', but only seat 0 can start the next round, while the table labels the round's leader 'წამყვანი'. | [src/online/components/Hud/RoundResult.jsx:66](src/online/components/Hud/RoundResult.jsx:66) | Name the seat-0 player, or use a different word (e.g. 'მასპინძელს'). |
| C-L17 | A quit confirmation the player has open is hidden by another player's quit proposal and pops back up when that proposal ends. | [src/online/components/Hud/QuitModal.jsx:72](src/online/components/Hud/QuitModal.jsx:72) | In GameLayout, clear `confirmQuit` when `quitProposal` becomes set. |
| C-L19 | Closing the profile sheet (Escape, X or backdrop) keeps the PIN prompt and edit state, and both reappear when it reopens. | [src/online/components/Lobby.jsx:430](src/online/components/Lobby.jsx:430) | A `closeProfileSheet` that also clears pinPending, editPending, editing, editPin and showForm. |
| C-L20 | Deleting a profile asks for no confirmation. Two taps (pencil, then delete) remove a PIN-less profile, including every ჩაწერა player, from the shared list. Found by 2 auditors. | [src/online/components/ProfileForm.jsx:100](src/online/components/ProfileForm.jsx:100) | `window.confirm` or a two-step button, like King Score's Remove dialog. |
| C-L21 | Editing any profile also makes it the active profile, so fixing a friend's profile switches you to playing as them. A Lobby comment suggests this is deliberate. | [src/online/components/ProfileForm.jsx:91](src/online/components/ProfileForm.jsx:91) | If unwanted, lock a profile in only on create, or when editing the already-active one. |
| C-L22 | Insights panels keep a stale selected player after the ყველა/ონლაინ/ლაივი filter changes: the dropdown shows the first name while the data is the old player's. Found by 2 auditors. | [src/online/components/LeaderboardPanels/HeadToHeadPanel.jsx:54](src/online/components/LeaderboardPanels/HeadToHeadPanel.jsx:54) | `<Insights key={gameType} …/>` in Leaderboard.jsx. |
| C-L23 | The achievements dropdown also includes names from `Object.keys(lifetime)`, so removed ჩაწერა players appear there but nowhere else. | [src/online/components/LeaderboardPanels/AchievementsPanel.jsx:17](src/online/components/LeaderboardPanels/AchievementsPanel.jsx:17) | Use `players.map(p => p.name)` only. |
| C-L24 | Rankings crash when the filtered games contain only removed players: `leader` is undefined, and there is no error boundary. | [src/online/components/Leaderboard.jsx:229](src/online/components/Leaderboard.jsx:229) | Show the empty state when `aggregated.length === 0`. |
| C-L25 | The player profile always shows the rank by wins, so with score sorting the #01 row opens a profile that says '#03 რეიტინგში'. | [src/online/components/Leaderboard.jsx:217](src/online/components/Leaderboard.jsx:217) | Pass the rank from the same sorted list the table shows. |
| C-L26 | The admin sound edit inputs use #eeeae1 text on a #fff background, so typed text is invisible. Found by 2 auditors. | [src/online/components/Admin/AdminApp.jsx:171](src/online/components/Admin/AdminApp.jsx:171) | Use UploadForm's `rgba(35,57,45,0.95)` background (one shared input style). |
| C-L27 | A profile deleted on another device gets 'არასწორი კოდი' on every PIN attempt. | [src/online/components/PinPromptModal.jsx:77](src/online/components/PinPromptModal.jsx:77) | On `reason === 'not_found'`, show 'პროფილი აღარ არსებობს', close the prompt and `reload()`. |
| C-L29 | A delayed live-sheet PUT can land after the DELETE that follows a save, bringing back a "waiting to be saved" sheet for 3 hours. Rare. | [src/score/App.jsx:151](src/score/App.jsx:151) | Keep the timer and its promise in refs; clear and await them before `removeLiveSheet`. |
| C-L30 | When `reloadGameData` calls overlap, `follow` applies whichever load finishes last, so an older load can overwrite newer data. Found by 2 auditors. | [src/score/lib/gameData.js:56](src/score/lib/gameData.js:56) | In `follow`, ignore results when `promise !== current`. |
| C-L31 | `firstInputRef` is attached to every count input, so autofocus lands on the last player. Found by 2 auditors. | [src/score/components/GameTypeSelector.jsx:130](src/score/components/GameTypeSelector.jsx:130) | `ref={i === 0 ? firstInputRef : undefined}`. |
| C-L32 | Clicking the same matrix cell again, after picking another type in the selector, does nothing. | [src/score/App.jsx:355](src/score/App.jsx:355) | Lift `selectedTypeCode` into App and share the setter; delete the unused `preselectGameType` listener. |
| C-L33 | TrophyIcon drops the `style` prop, so the champion's trophy touches the name. | [src/score/components/SeasonChampionsTab.jsx:86](src/score/components/SeasonChampionsTab.jsx:86) | Accept and merge `style` in TrophyIcon.jsx. |
| C-L34 | Confetti and the win fanfare replay every time a finished, unsaved sheet is reloaded. | [src/score/App.jsx:184](src/score/App.jsx:184) | Celebrate in `onRoundComplete` when the last round is entered, not in an effect on `gameFinished`. |
| C-L35 | The new-round and total animations can show the final value for one frame before counting up. | [src/score/components/ScoreTable.jsx:48](src/score/components/ScoreTable.jsx:48) | Use `useLayoutEffect` for the new-row and totals bookkeeping. |
| C-L36 | Unguarded `localStorage` reads in `useState` initializers crash King Score when site data is blocked (there is no error boundary). | [src/score/App.jsx:87](src/score/App.jsx:87) | A small try/catch storage helper for all of App.jsx's calls. |
| C-L37 | If another phone removes a player mid-game, the sheet can no longer be saved ('Unknown player — reload the player list.'), and only Reset gets out. | [src/score/App.jsx:200](src/score/App.jsx:200) | Refuse to delete players used in a recent live sheet, or save an unknown player as a name-only slot. |
| C-L38 | Dark-theme colours left in the cream in-game sheets have low contrast: the WinProbability track and #d7fa52 bar, `.k-muted`, `.k-table-menu small` and `.k-recording`. | [src/online/styles/index.css:5157](src/online/styles/index.css:5157) | Add `body.king-light-game` overrides with darker colours. |
| C-L39 | The global `button:disabled { opacity: .4 }` fades every occupied seat on the public table, including your own. | [src/online/styles/index.css:64](src/online/styles/index.css:64) | Render occupied seats as a non-button, or add `.k-seat-avatar:disabled:has(.k-avatar) { opacity: 1 }`. |
| C-L40 | King Score CSS leftovers: the new-row flash animates the row, which is hidden behind solid cells; the matrix legend dots have no colour; the `sticky` header class has no CSS. | [src/score/styles/main.css:685](src/score/styles/main.css:685), [src/score/styles/main.css:440](src/score/styles/main.css:440) | Flash the cells with an inset box-shadow; add `.legend .dot.available/.used` colours; drop or implement `sticky`. |
| C-L41 | King Score dark mode doesn't set `color-scheme` or update `theme-color`, so scrollbars, dropdown menus and the phone's top bar stay light. | [src/score/styles/main.css:102](src/score/styles/main.css:102) | In the darkMode effect, set `documentElement.style.colorScheme` and the theme-color meta tag. |
| C-L42 | Winner names are joined with ' & ' and split again, so a player named like 'Tom & Jerry' loses their wins, and 'Tom' and 'Jerry' get credited instead. | [src/score/lib/gameShapes.js:28](src/score/lib/gameShapes.js:28) | Keep a `winners` array of names; reject ' & ' in player names. |
| C-L43 | ScoreChart, LiveSheets, GameAnalytics and GlobalAnalyticsPage import `PLAYER_COLORS` from App.jsx, which imports them back (a circular import). Chart lines are keyed by name, so two players with the same name merge. | [src/score/components/ScoreChart.jsx:4](src/score/components/ScoreChart.jsx:4) | Move the colours to `constants/colors.js`; key lines by `p.id`. |
| C-L44 | The shuffle sound creates a new `Audio` during a socket-driven render, which iOS blocks. | [src/online/game/scenes/GameScene.js:742](src/online/game/scenes/GameScene.js:742) | Pre-build it in the primed audio pool and trigger it through EventBus. |
| C-L46 | render.yaml says to use the transaction pooler (:6543), but server/.env.example uses the session pooler (:5432). Either works; the docs just conflict. | [render.yaml:20](render.yaml:20) | Pick one mode and say so in render.yaml, .env.example, README and connection.js. |


---

## Performance & optimization
The biggest waste — base64 profile photos copied into every broadcast, snapshot and game row — is fixed: photos are cacheable links now. On the client, the Phaser table rebuilds and redraws much more often than needed, and King Score downloads its whole history and every page before it shows anything.

### P2. Lobby lists are broadcast to every socket on each presence change · Medium
**Where:** [server/socket/handlers.js:1172](server/socket/handlers.js:1172), [server/socket/handlers.js:134](server/socket/handlers.js:134)
**Problem:** The photos are gone from these lists (they're short links now, and `online-players` has none), but `online-players`, `live-games`, `public-room` and `tournament-list` still go to every connected socket on every announce, watch, game start/end and disconnect — including disconnects of sockets that never announced. Each push rebuilds the context value and re-renders the in-game HUD, mid-game too.
**Fix:**
- In `disconnect`, broadcast only if `forgetPresence`, `removeSpectator` or `markDisconnected` actually changed something, and announce once per connect on the client.
- Emit lobby events to a `lobby` socket room that table sockets leave, and add a trailing debounce of about 300 ms to `_refreshLobby`.

### P5. Trump-sparkle tweens leak on every re-render · Medium
**Where:** [src/online/game/scenes/GameScene.js:779](src/online/game/scenes/GameScene.js:779), [src/online/game/scenes/GameScene.js:424](src/online/game/scenes/GameScene.js:424)
**Problem:** In a trump round, each trump card in hand gets a `repeat: -1` alpha tween on its sparkle Graphics. `_clearDynamic` destroys the hand on every render, but Phaser 3.90's `GameObject.destroy` does not remove tweens, and `TweenData` keeps updating the destroyed target forever. There are about 60–80 renders per round and up to 9 trump rounds. By the end of a game, several hundred to about 1,000 orphaned tweens are running every frame until the scene is destroyed at game over. Frame time and battery drain on phones grow steadily through the game.
**Fix:** Remove each tween together with its target: `const tw = this.tweens.add({...}); sparkle.once('destroy', () => tw.remove());`. Alternatives: call `this.tweens.killTweensOf(...)` on the sparkles in `_clearDynamic`, or create one looping scene-level tween in `create()` whose `onUpdate` sets the alpha of the current sparkles.
*Found by 3 auditors.*

### P6. The Phaser table is torn down and rebuilt on every state update, chat bubbles included · Medium
**Where:** [src/online/game/scenes/GameScene.js:354](src/online/game/scenes/GameScene.js:354), [src/online/components/GameLayout.jsx:124](src/online/components/GameLayout.jsx:124), [src/online/game/scenes/GameScene.js:1052](src/online/game/scenes/GameScene.js:1052)
**Problem:** `_renderAll` always calls `_clearDynamic()` and then recreates every card, avatar (each with a new geometry mask), trick and bubble. Each face-up card is 2 Graphics plus 4 Text objects, and every Text measures, draws and uploads its own GPU texture, so one render creates and destroys about 60–80 textures. That happens about 7–8 times per trick, and again for identical-state re-pushes: scene-ready, the four boot timers, force-render, resize and avatar loads.

`chatBubbles` (with the typing placeholders) is part of the canvas `gameState`. So every chat message, voice note, sound press, typing start/stop and bubble expiry also rebuilds the whole table. A bubble on screen replays its pop-in each time a card is played, and a hovered card snaps back down. Spectator messages (`seat: null`) trigger rebuilds for bubbles the scene then discards.
**Fix:**
- Skip identical states: in `_onStateUpdate`, return when `state === this._lastRenderedState` unless the render is forced. Pass `forced` from the resize, avatar-loaded, force-render, visibility and gate-release paths.
- Move bubbles out of `gameState`. Emit them on their own EventBus event that rebuilds only `this.chatObjs`, and animate only bubbles whose `seat+message+at` key is new. Ignore `seat == null` in `setChatBubbles` and `setTypingSeats` (GameContext.jsx:886, :974).
- Later: bake card faces into textures (issue 7), and diff the hand and trick by card id instead of clearing them.
*Found by 4 auditors.*

### P7. Cards, plates and badges are live Graphics, re-triangulated every frame at an uncapped 60 fps · Medium
**Where:** [src/online/game/objects/Card.js:26](src/online/game/objects/Card.js:26), [src/online/game/PhaserGame.jsx:26](src/online/game/PhaserGame.jsx:26)
**Problem:** Phaser's WebGL Graphics renderer replays and triangulates every command buffer on every frame. The table has about 60+ Graphics objects:
- each face-up card has 2–4 (shadow, body and stroke, accent or sparkle);
- each opponent card back has a shadow;
- avatar plates, badges, coins and pills add more.

Each 3 px rounded rect is about 400 points run through Earcut, every frame, even while nobody is acting. The game config sets no fps limit, so phones pay this CPU and battery cost for the whole 27-round game.
**Fix:**
- In PreloadScene or `create()`, bake the card body and shadow (ideally all 32 faces with their glyphs) and the avatar plate and badge into textures once, with `graphics.generateTexture()` or a RenderTexture. Draw them as Images and use `setTint` for colour variants.
- Bake the static felt and watermark into one RenderTexture.
- Optional: add `fps: { limit: 30 }` to the game config.

### P8. King Score's first screen waits for the full game history, most of which it throws away · Medium
**Where:** [src/score/lib/gameData.js:24](src/score/lib/gameData.js:24), [src/score/lib/gameData.js:22](src/score/lib/gameData.js:22), [src/score/lib/gameData.js:68](src/score/lib/gameData.js:68)
**Problem:** `load()` fetches `/api/players` and `/api/games?limit=all&avatars=0` together, and `usePlayers` shows "Loading players..." until both finish. Starting a table game therefore waits for the entire `finished_games` history, at about 10 KB of roundDetails per row. No `mode` is sent, so every casual King Online game is downloaded and parsed, then dropped by the `isChampionship` filter. The same full reload runs after every game save. Adding or removing a player awaits it too, so the Add button stays disabled meanwhile. The payload has no upper bound, and a cold Vercel instance makes it slower because the mirror pulls the whole table first.
**Fix:**
- Add `&mode=championship` to the request at line 24. Every live row is saved with `isChampionship: 1` (server/games/scoreSheet.js:104), so this returns exactly the set the client keeps.
- Split the cache. Let players resolve on their own so the picker renders immediately, and load games separately for History, Stats and Players. When the player list changes, rebuild the online legacy rows from the cached raw games (their ids come from `idOfName`) instead of refetching.
- Don't `await` the full reload in `savePlayer`/`removePlayer`.
*Found by 3 auditors.*

### P9. King Score ships as one eager chunk of about 168 KB gzip · Medium
**Where:** [src/score/App.jsx:8](src/score/App.jsx:8), [src/score/App.jsx:27](src/score/App.jsx:27), [src/score/App.jsx:31](src/score/App.jsx:31), [app/(score)/score/ScoreApp.jsx:8](<app/(score)/score/ScoreApp.jsx:8>)
**Problem:** App.jsx statically imports:
- every page (Players, Winners, Stats → GlobalAnalytics, More);
- the finished-game charts (recharts 3);
- `canvas-confetti`;
- supabase-js, through useSeasons.

The measured chunk is about 621 KB raw, 168 KB gzip. `dynamic(..., { ssr: false })` has no `loading` shell, so phones see a blank screen until all of it downloads and parses, on the first visit and after every deploy. Leaf components also import `PLAYER_COLORS` from `../App`, an import cycle that would tie any lazy chunk back to App.
**Fix:**
- Move `PLAYER_COLORS` to `src/score/constants/colors.js`, and import it from there in App, LiveSheets, GameAnalytics, ScoreChart and GlobalAnalyticsPage.
- Use `React.lazy` with `Suspense` for WinnersPage, StatsPage, PlayersPage, MorePage, ScoreChart and GameAnalytics. Load confetti with `import('canvas-confetti')` in the game-finished effect.
- Pass a light `loading` shell to `dynamic()` in ScoreApp.jsx. Removing supabase-js (L9) shrinks the chunk further.
*Found by 2 auditors.*

### Low-severity
| # | Issue | Where | Fix |
|---|---|---|---|
| P-L2 | The desync watchdog fires `request-state` whenever an opponent takes over 9 s. The reply carries all avatars and roundDetails and forces a full rehydrate and canvas rebuild. | [src/online/context/GameContext.jsx:217](src/online/context/GameContext.jsx:217) | Add a state version so the server can answer "up to date". Once avatars are gone (issue 4), each resync is about 10–20 KB. |
| P-L4 | The live-sheets list polls every 8 s with no visibility check (3 auditors). | [src/score/lib/gameData.js:108](src/score/lib/gameData.js:108) | Skip `load()` while `document.hidden`, and call it once on `visibilitychange` back to visible. |
| P-L6 | `verifyProfilePin` and `upsertProfile` go through `getProfile`, which syncs the whole profiles mirror. A cold instance downloads every avatar just to read one pin_hash. | [server/db/store.js:172](server/db/store.js:172) | Use `SELECT pin_hash FROM profiles WHERE id = $1`, and have upsert use `RETURNING`. |
| P-L7 | The games mirror cold-syncs in sequential 50-row chunks and always fetches avatar blobs, even for `avatars=0` readers. | [server/db/store.js:77](server/db/store.js:77) | Load the avatar pool on the first full-payload read instead. Optional: fetch chunks with a concurrency of about 3. |
| P-L8 | The sound audio route ignores `?v=` but always answers immutable, so any random `v` skips the CDN and re-reads up to about 2.7 MB from Postgres. | [app/api/sounds/[id]/audio/route.js:17](app/api/sounds/[id]/audio/route.js:17) | Return `updated_at` from `getSoundAudio`, and redirect or send `no-store` when `v` doesn't match. |
| P-L10 | The History tab renders every game with no paging and runs `details.some(...)` for each card. OnlineHistoryTab has no cap either (2 auditors). | [src/score/components/WinnersPage.jsx:186](src/score/components/WinnersPage.jsx:186) | Show 50 rows with a "show more" button in both lists, and precompute a `Set` of detail ids. |
| P-L11 | Each profile open recomputes lifetime achievements for every player over the whole history, to show one player. | [src/online/components/LeaderboardPanels/PlayerProfile.jsx:72](src/online/components/LeaderboardPanels/PlayerProfile.jsx:72) | Pass that player's `matches` to AchievementsPanel instead of `games`. |
| P-L12 | The rivalries list is unsorted, so the first 6 are the most recently seen pairs, not the biggest rivalries. | [src/online/components/LeaderboardPanels/RivalryGraph.jsx:43](src/online/components/LeaderboardPanels/RivalryGraph.jsx:43) | Sort by games shared, descending, before slicing. |
| P-L13 | The first tap anywhere, even on the homepage, primes every reaction clip and downloads about 1.2 MB of audio (2 auditors). | [src/online/context/GameContext.jsx:323](src/online/context/GameContext.jsx:323) | Prime inside the gestures that lead to a table (sit, create, join, watch), and keep the global listener only while `appPhase !== 'lobby'`. Keep priming each element separately, because iOS needs it. |
| P-L14 | The Phaser/GameLayout chunk (about 337 KB gzip) is prefetched only in WaitingRoom, so quick-match and tournament players download it as the game starts. The loader text is dark brown on near-black (2 auditors). | [src/online/App.jsx:9](src/online/App.jsx:9), [src/online/App.jsx:31](src/online/App.jsx:31) | Fire `import('./components/GameLayout')` when a public seat is taken or a tournament is joined. Give the loader text a light colour. |
| P-L16 | The full Phaser build (physics, tilemaps) is bundled for a scene that only uses Graphics, Text, Image, Container and tweens. | [src/online/game/PhaserGame.jsx:2](src/online/game/PhaserGame.jsx:2) | Optional custom build. `phaser-core` lacks Container, Rectangle and Math.Clamp, so add those. Measure before and after. |
| P-L17 | The manual `scale.refresh()` on every viewport event resizes nothing, because FIT mode reads a cached parent size, but it still triggers a full `_renderAll`. | [src/online/game/PhaserGame.jsx:64](src/online/game/PhaserGame.jsx:64) | Delete the listener effect, since Phaser already polls. In `_onResize`, rebuild only when the size or layout changed. |
| P-L18 | Four boot re-pushes repaint identical state and can cut the round-1 deal animation. A refresh while holding 9+ cards replays the deal. | [src/online/game/PhaserGame.jsx:105](src/online/game/PhaserGame.jsx:105), [src/online/game/scenes/GameScene.js:736](src/online/game/scenes/GameScene.js:736) | The identity skip in issue 6 makes the re-pushes harmless. Detect a fresh deal from a counter bumped in the `hand-dealt` handler. |
| P-L19 | `backdrop-filter: blur` on modal and sheet backdrops sits over a canvas that repaints every frame. | [src/online/styles/index.css:197](src/online/styles/index.css:197) | Set `backdrop-filter: none` under `body.king-light-game`; the scrims are already about 80% opaque. |
| P-L20 | Fonts come from a render-blocking Google Fonts stylesheet with only weights 400–700, while the CSS uses 200–800. The ttf/otf files in public/fonts are unused (2 auditors). | [app/(online)/layout.jsx:40](<app/(online)/layout.jsx:40>) | Switch to `next/font/google` with variable Inter and Noto Sans Georgian, and delete public/fonts/*. Then check the wordmark and rank numerals visually. |
| P-L21 | Emoji taps are unthrottled, and each one `io.emit`s `public-room`, avatars included, to every socket. | [src/online/components/PublicRoomPanel.jsx:148](src/online/components/PublicRoomPanel.jsx:148), [server/socket/handlers.js:347](server/socket/handlers.js:347) | Skip unchanged emoji on both client and server, and drop server calls under about 750 ms per socket. |
| P-L22 | TournamentPanel re-requests the tournament list on every roster change, duplicating the server's own broadcast. | [src/online/components/Tournament/TournamentPanel.jsx:31](src/online/components/Tournament/TournamentPanel.jsx:31) | Depend on `[connected, refreshTournaments]` only. |
| P-L23 | TournamentPanel is lazy-loaded although it is tiny, which costs a round trip and an "იტვირთება…" flash on the first tab click. | [src/online/components/Lobby.jsx:25](src/online/components/Lobby.jsx:25) | Import it statically and remove the Suspense wrapper. |
| P-L24 | Finished, rematched and hydrated rooms are never garbage-collected. The grace timer fires once and needs every row to be disconnected. | [server/game/GameManager.js:588](server/game/GameManager.js:588) | Delete finished rooms on an unconditional TTL, arm the grace timer for hydrated rooms, and mark the old row disconnected on rematch or final. |
| P-L25 | Render cold start: the 8 s socket `timeout` aborts and retries handshakes while the server boots, and the only message shown is "სერვერთან დაკავშირება…". | [src/online/context/GameContext.jsx:353](src/online/context/GameContext.jsx:353) | Raise `timeout` to about 20–30 s, and show a "server waking up" note after about 5 s. |
| P-L26 | API client errors are string-matched (`includes('HTTP 401')`), have no timeout, and show raw English server text inside Georgian messages. | [src/online/lib/api.js:57](src/online/lib/api.js:57) | Throw an `ApiError` with a `status`, add `AbortSignal.timeout`, and map server errors to Georgian strings. |
| P-L27 | CSS cascade fights: `!important` chains between index.css, game-light.css and inline styles. Utility classes like `rounded-2xl` are silently overridden because component CSS comes after `@tailwind utilities`. | [src/online/styles/game-light.css:406](src/online/styles/game-light.css:406), [src/online/styles/index.css:3](src/online/styles/index.css:3) | Move the GameLayout and GameOverScreen inline styles into CSS and drop the `!important`s. Remove the no-op utility classes. Don't wrap everything in `@layer`. |
| P-L28 | game-light.css overrides most of index.css's dark in-game rules, leaving them dead. The body class is added in `useEffect`, so one dark frame can paint. | [src/online/styles/game-light.css:2](src/online/styles/game-light.css:2), [src/online/components/GameLayout.jsx:30](src/online/components/GameLayout.jsx:30) | Switch to `useLayoutEffect`, and prune the dead dark rules gradually. |
| P-L29 | The King Score theme scenery animates `left`/`margin-top` (birds) and `background-position` (waves) forever, on the main thread. | [src/score/styles/main.css:952](src/score/styles/main.css:952) | Rewrite both keyframes with `transform: translate(...)`. |
| P-L30 | The King Online manifest has no 512 px icon (see X-L3). | [public/manifest.json:11](public/manifest.json:11) | Add one. |


---

## Duplicated code & oversized components
Most of the debt sits in four very large files: `GameContext.jsx` (1,404 lines), `handlers.js` (1,424), `GameScene.js` (1,071) and `store.js` (1,005). The rest is game rules copied between the server, King Online and King Score. Most of this only makes the code harder to change. A few copies have already drifted apart and now cause visible bugs: the results screen and game history show different card totals for the same game, chart tooltips in King Score are unreadable in dark mode, and the bracket button used to disappear after a tournament reconnect (fixed).

### D1. Results screen and game history show different card totals for the same game · Medium
**Where:** [src/online/components/GameOverScreen.jsx:113](src/online/components/GameOverScreen.jsx:113), [src/online/components/LeaderboardPanels/GameDetail.jsx:64](src/online/components/LeaderboardPanels/GameDetail.jsx:64), [server/game/GameState.js:361](server/game/GameState.js:361)
**Problem:** `GameState` counts queens, jacks, hearts and K♥ on every trick of every round. GameDetail (leaderboard → game report) counts each of them only in its own round type: queens in Q rounds, K♥ in K rounds, and so on. That is the same rule the server's `getLifetimeStats` uses. GameOverScreen has a hand-copied version of that tally that adds them up over all 27 rounds. So the results screen's details tab shows inflated numbers (K♥ can be counted in nearly every round), while the same game in history shows the correct, smaller ones. The same component also re-implements RoundBreakdownTable as a ~150-line inline table (412–561), copies the gradient card wrapper three times (292, 376, 413), and at 537–546 sets an inline colour that overrides `scoreColorClass(v)`.
**Fix:**
- Move GameDetail's per-type tally into `src/online/utils/gameStats.js` as `computeGameStats(playerList, details)`, adding best/worst round. Use it in both components and map GameOverScreen's field names (`queensTaken` → `queens`, …).
- Render `RoundBreakdownTable` from GameOverScreen with an optional `showLeader` column, and drop the redundant inline colour.
- Extract a `<ResultsCard title>` wrapper and move its inline styles into CSS classes.
*Found by 2 auditors.*

### D2. King Score charts ignore dark mode, so tooltip text is unreadable · Medium
**Where:** [src/score/components/ScoreChart.jsx:6](src/score/components/ScoreChart.jsx:6), [src/score/components/GameAnalytics.jsx:12](src/score/components/GameAnalytics.jsx:12), [src/score/components/GlobalAnalyticsPage.jsx:14](src/score/components/GlobalAnalyticsPage.jsx:14), [src/score/styles/main.css:102](src/score/styles/main.css:102)
**Problem:** `getCssVar` is copy-pasted into three chart components, and every copy reads from `document.documentElement`. The dark-mode and season-theme variables are declared on `body.dark` / `body.theme-*` (main.css:40–140), and custom properties don't inherit upward, so every chart always gets the light `:root` values. In dark mode the result is:
- the tooltip box is `#ffffff`, but its label inherits the body's light text colour (`#e6edf3`), so it is almost invisible;
- the zero `ReferenceLine` is drawn in the light theme's dark `--text` colour on a dark card;
- the grid lines use the light theme's colours.
The values are also read during render, so switching theme doesn't update a chart that is already showing.
**Fix:**
- Add `src/score/utils/chartTheme.js` with a `useChartTheme(darkMode, theme)` hook that reads `getComputedStyle(document.body)` and returns `{ grid, muted, text, tooltipStyle }`. Re-read when the theme changes.
- Give `tooltipStyle` an explicit `color` (or use `'var(--tooltip-bg)'` / `'var(--text)'` strings directly, since `contentStyle` is plain inline CSS).
- Delete the three `getCssVar` copies and the repeated grid/axis/tooltip objects in all three files.

### D5. Screen wake lock is lost for the rest of the game after one app switch · Medium
**Where:** [src/online/components/GameLayout.jsx:223](src/online/components/GameLayout.jsx:223), [src/online/components/GameLayout.jsx:215](src/online/components/GameLayout.jsx:215), [src/online/components/ChatOverlay.jsx:125](src/online/components/ChatOverlay.jsx:125)
**Problem:** GameLayout (377 lines, though its own comment calls it "intentionally thin glue") has an inline wake-lock effect. It stores the lock in `lock` but never sets it back to `null` when the browser releases the lock on hide. After the player switches apps or tabs once, `onVisibility` sees a non-null `lock` and never asks for a new one, so the phone screen can dim and lock mid-game. ChatOverlay (360 lines) has a similar inline-hook problem: while `getUserMedia` is pending, `recording` is still false, so a second tap starts a second recorder. The first recorder is then orphaned and its mic stream stays open.
**Fix:**
- Extract `useWakeLock(active)` and add `lock.addEventListener('release', () => { lock = null })` after each successful request.
- Extract `useVoiceRecorder()` with a `startingRef` guard against starting twice.
- Optional: move `useTurnNudge()` and `<TournamentChrome/>` out of GameLayout.

### D6. GameContext.jsx is a 1,404-line god-provider · Medium
**Where:** [src/online/context/GameContext.jsx:56](src/online/context/GameContext.jsx:56), [src/online/context/GameContext.jsx:335](src/online/context/GameContext.jsx:335), [src/online/context/GameContext.jsx:1344](src/online/context/GameContext.jsx:1344)
**Problem:** One provider holds:
- 54 `useState` and 20 refs;
- a single mount-only effect (335 to about 1135) that registers 46 `socket.on` listeners;
- about 35 action callbacks and the audio pool (256–333);
- one `gameValue` memo with about 85 keys.
The server sends the lobby and tournament broadcasts to every socket, so every presence, live-games or tournament-list change re-renders all ~25 `useGame()` consumers, GameLayout included, in the middle of a game. The listeners live inside a component closure, so none of the game-event logic can be unit-tested. Partial resets copied across handlers (issue 4 and row L13) keep drifting.
**Fix (one step at a time):**
- Move `onlinePlayers`, `liveGames`, `tournamentList`, `tournamentOverview` and `toasts` into their own Lobby/Toast contexts. Keep `useGame()` as a shim that merges them until consumers migrate.
- Turn the table events (game-state, hand-dealt, card-played, trick-complete, round-complete, game-over) into a pure `tableReducer` with `node --test` coverage, and keep the trick timers next to it.
- Extract `useReactionAudio` and a ChatProvider for the existing ChatContext.
*Found by 3 auditors.*

### D7. handlers.js is one ~1,065-line registerHandlers closure · Medium
**Where:** [server/socket/handlers.js:146](server/socket/handlers.js:146), [server/socket/handlers.js:127](server/socket/handlers.js:127), [server/socket/handlers.js:1245](server/socket/handlers.js:1245), [server/socket/handlers.js:1343](server/socket/handlers.js:1343)
**Problem:** One closure registers 35 socket events: rooms, quick-match, play, quit votes, chat/voice/sound, rematch, presence and watching, 7 tournament events, and disconnect. Module scope adds `_finishGame`, the tournament broadcaster and the `tournamentManagerRef` global, which is set on the first connection (127, 152). This one closure is where most of the copy-paste comes from:
- issue 3 above;
- the lobby broadcast (×3) and the game-start block (×3);
- the seat lookup at the top of 9 handlers;
- select-trump never saving the game state, unlike the other game actions.
**Fix:**
- Start with the cheap helpers from issue 3 and rows L3–L7: `_refreshLobby` only, `_emitGameStart`, `withSeat(fn)`, `emitReconnect`, `startWatching`/`stopWatching`.
- Then split into `server/socket/{rooms,play,social,lobby,tournament}.js`. Each exports `register(io, socket, ctx)` with `ctx = { gameManager, tournamentManager, emitError }`.
- Move `_finishGame` and the broadcaster into their own module, pass `tournamentManager` explicitly, and delete `tournamentManagerRef`.
- Move one module per commit and run the existing socket smoke tests after each.
*Found by 4 auditors.*

### D8. The achievement engine is implemented twice · Medium
**Where:** [src/online/utils/achievements.js:93](src/online/utils/achievements.js:93), [src/score/utils/achievements.js:43](src/score/utils/achievements.js:43), [src/online/utils/achievements.js:197](src/online/utils/achievements.js:197), [src/score/utils/achievements.js:142](src/score/utils/achievements.js:142)
**Problem:** Both apps run the same algorithm step for step:
- running totals with the never-below-zero check, and the last-place counter for UNDERDOG;
- PERFECT_PLUS, PLUS_PERFECTIONIST, UNTOUCHABLE, and RUNAWAY_WIN (sole winner, 100+ points ahead);
- the GAMES/WINS/STREAK milestones (an array in King Online, an if-chain in King Score).
Only the round shape differs: King Online uses seat plus `queensTaken`/`trickWinners`, King Score uses player id plus `countsByPlayerId`. Achievements are what you are changing right now (uncommitted badge art and `AchievementBadges.jsx` edits). Every rule or threshold change has to be made twice, or the same player gets different badges in each app. The two apps also count different games (King Score uses championship games only, `gameData.js:38`); that is on purpose but not written down anywhere.
**Fix:**
- Extract a pure engine with no icons into a module both clients import (for example `src/shared/achievementsEngine.js`). It takes normalised rounds `{ scores, gameType, leader, counts, target }` keyed by any id, plus the milestone tables.
- King Online adapts `roundDetails` with its existing `unitCounts`. King Score passes its legacy rows straight in, which also covers the in-progress sheet in `GameAnalytics.jsx:20`.
- Keep `ACHIEVEMENT_DEFS` and `AchievementBadges` per app, and add a comment explaining the different game sets.
- While there, use `winnersOf` from `lib/leaderboard.js` in `computeAllLifetimeAchievements` (achievements.js:241) and in GameOverScreen instead of re-deriving winners.
*Found by 3 auditors.*

### D9. GameScene.js (1,071 lines) mixes rules, layout, lifecycle and six renderers · Medium
**Where:** [src/online/game/scenes/GameScene.js:140](src/online/game/scenes/GameScene.js:140), [src/online/game/scenes/GameScene.js:87](src/online/game/scenes/GameScene.js:87)
**Problem:** One Phaser class owns all of this:
- the layout tables (`layoutFor`, `isPortraitBox`, `sceneSize`);
- a copy of the play-legality rules;
- EventBus, visibility and resize wiring;
- the trick-animation gate and watchdog;
- six renderers, including `_renderAvatars` (~210 lines) and `_renderHand` (~170 lines). They share mutable fields such as `_animatingTrick`, `_trickWatchdog` and `_lastDealRound`.
It is your most-edited large file (4 of the last 14 commits), and every change risks breaking the fragile gate logic. None of it can be tested in node because the module imports Phaser. `objects/Hand.js` and `objects/TrickArea.js` are left over from an earlier split and nothing imports them.
**Fix:**
- Move `layoutFor`, `isPortraitBox` and `sceneSize` to `game/layout.js`, and the rule core to the shared rules module (L1). Both become pure and node-testable.
- Extract HandView, AvatarsView, TrickView (swoop, gate and watchdog together) and ChatBubblesView, each with `render(state, L)` and `destroy()`. Keep the current clear-and-redraw approach.
- Delete or reuse `objects/Hand.js` and `objects/TrickArea.js`.
*Found by 2 auditors.*

### Low-severity
| # | Issue | Where | Fix |
|---|---|---|---|
| D-L1 | Client play/discard legality is a hand-kept copy of the server's rules: `isPlayableCard`, `isCardRestricted` and `TRUMP_TYPES` (4 auditors). | [src/online/game/scenes/GameScene.js:87](src/online/game/scenes/GameScene.js:87) | Create `server/game/rules.js` (CJS, no deps) with `TRUMP_TYPES`, `canDiscard` and a pure `legalPlay()`. GameState, GameScene, DiscardSelector and `fullgame.smoke.js` import it; the client keeps its `currentTrick.length === 3` UI gate. |
| D-L2 | King's game-type rules (codes, units, points, 27 rounds) are copied in ~10 places, with mismatched field names (`pointPerUnit` vs `pointsPerUnit`) (6 auditors). | [server/game/GameState.js:14](server/game/GameState.js:14) | Extend `server/game/constants.js` GAME_TYPES with units, points, sign and `TOTAL_ROUNDS`. Derive ScoreCalculator, `QUIT_ROUND_TOTALS`, `_checkRoundEnd`, scoreSheet `TAKEN_FIELD`, the score analytics code lists and the literal 27s from it. It must stay under `server/` (Render rootDir). |
| D-L3 | Lobby broadcast written three times (5 auditors). | [server/socket/handlers.js:925](server/socket/handlers.js:925) | Delete `_broadcastLobby` and the inline pair in disconnect (1172) and call `_refreshLobby(io, gameManager)` everywhere. `lobby-info` (939) sends to one socket only and stays as it is. |
| D-L4 | Game-start broadcast (game-started + hand-dealt + lobby refresh) copied 3× (2 auditors). | [server/socket/handlers.js:304](server/socket/handlers.js:304) | Add `_emitGameStart(io, gameManager, room, gs, roomCode)` next to `_emitHandDealt`. Use it in sit-public, start-game and `startTable` (1367). |
| D-L5 | Game-action handlers repeat the mapping→room→gameState lookup; select-trump never persists (4 auditors). | [server/socket/handlers.js:441](server/socket/handlers.js:441) | Add `withSeat(fn, { needGame })` in handlers and `_mutateGame(roomCode, fn)` in GameManager (persist on ok). Add `handleSelectTrump` so a restart after trump selection doesn't roll the round back to trump selection. |
| D-L6 | GameState duplicates round bookkeeping and its two client views; the cardCounts loop is written 6× (5 auditors). | [server/game/GameState.js:412](server/game/GameState.js:412) | Add `_recordRound()` (412/480), `_freshRoundState()`, a shared `_publicView()` for `getStateForPlayer`/`getStateForSpectator` (576/631), and `GameState#cardCounts()` for handlers.js 506/518/699/1407. Add `emitRoundComplete` for 537/701. |
| D-L7 | Small server helpers duplicated: `generateCode` ×2, inline lower-case name compares ×6 (TournamentManager already has `sameName`), tournament-list mapping ×3 (sent twice on tournament-leave), mode normalisation ×6 (5 auditors). | [server/tournament/TournamentManager.js:5](server/tournament/TournamentManager.js:5) | Create `server/lib/util.js` with `generateCode`, `sameName` and `normalizeMode`, and add `tournamentManager.openLobbyViews()`. In tournament-leave, emit the list only when `res.tournament` is null. |
| D-L8 | GameManager.js (794 lines) mixes rooms, persistence, presence, spectators, quick-match and rematch (2 auditors). | [server/game/GameManager.js:24](server/game/GameManager.js:24) | Optional: move snapshot/persist/hydrate into `roomPersistence.js` and presence/spectators into `presence.js`, keeping GameManager as the public API. |
| D-L9 | `server/db/store.js` (1,005 lines) covers ~9 data domains (4 auditors). | [server/db/store.js:61](server/db/store.js:61) | Optional: split along the existing section headers into `server/db/{mirror,profiles,games,live,sheets,seasons,sounds}.js`, with store.js re-exporting so imports don't change. Then unit-test the pure helpers. |
| D-L10 | store.js micro-duplicates: three status-error factories, `instanceof Date ? toISOString()` ×5, `listGames` vs `listGamesWithoutAvatars` (3 auditors). | [server/db/store.js:840](server/db/store.js:840) | Add `httpError(status, msg)` under `server/lib` and use it in store.js, scoreSheet.js and `lib/api/http.js`. Move store.js's local `iso()` (703) to module scope. |
| D-L11 | The round-trip test copies `rowToGame` instead of calling it, so API-shape changes still pass (2 auditors). | [tests/score-sheet-games.test.mjs:30](tests/score-sheet-games.test.mjs:30) | Export `rowToGame` from store.js (`getSql` is lazy, so requiring it is safe) and call it instead of `asServed`. |
| D-L12 | `deleteProfile`/`deletePlayer` check `pin_hash` and then DELETE in a separate statement (race). | [server/db/store.js:223](server/db/store.js:223) | Wrap both in `db().begin` with `SELECT … FOR UPDATE`, as `upsertProfile` does, or use `DELETE … WHERE id=$1 AND pin_hash IS NULL RETURNING id`. |
| D-L13 | GameContext repeats small helpers: bubble timer ×3, per-round reset ×2, seat-name lookup ×4, card equality ×3, an inline suit-name map, a hard-coded championship limit of 8, and a client copy of the server's `sharedId` formula (2 auditors). | [src/online/context/GameContext.jsx:853](src/online/context/GameContext.jsx:853) | Add `showBubble()`, `resetTrickState()`, `seatName()` and `sameCard()`, and import `SUIT_NAMES` from Icons.jsx at 641. Read the limit from the error payload. Have `_finishGame` send `gameId` and fall back to the current formula. |
| D-L14 | Suit symbol and Georgian name maps redefined in ~8 files (4 auditors). | [src/online/components/ui/PlayingCard.jsx:1](src/online/components/ui/PlayingCard.jsx:1) | Add `src/online/constants/suits.js` (symbols, names, `isRedSuit`); `Card.js` already exports `SUIT_SYMBOLS`. Keep the per-surface colours local, since they differ on purpose. |
| D-L15 | Win-probability model duplicated across the apps; the online WinProbability colours have drifted from ScoreChart despite its "same tri-color" comment (2 auditors). | [src/online/components/WinProbability.jsx:6](src/online/components/WinProbability.jsx:6) | Export one `PLAYER_COLORS` for ScoreChart, ProgressionChart and WinProbability. Optionally extract a pure `winProbabilities()`. |
| D-L16 | The online in-game ScoreChart is the same recharts chart as ProgressionChart; the chart theme is copied in three places (2 auditors). | [src/online/components/ScoreChart.jsx:29](src/online/components/ScoreChart.jsx:29) | Build the running-total rows in a memo and render `<ProgressionChart>`. Move palette, grid, axis and tooltip props into a `chartTheme.js` shared with SeasonRace. |
| D-L17 | Signed-number, win-rate and seat-sort one-liners repeated in ~10 components (2 auditors). | [src/online/components/LeaderboardPanels/SeasonsPanel.jsx:22](src/online/components/LeaderboardPanels/SeasonsPanel.jsx:22) | Optional: add `utils/format.js` with `signed()` and `winRate()`, and give the season and profile averages one rounding rule. |
| D-L18 | QuitModal renders two near-identical dialogs; GameScene repeats the gate-release/repaint block. | [src/online/components/Hud/QuitModal.jsx:42](src/online/components/Hud/QuitModal.jsx:42) | Extract `<QuitDialog>` inside QuitModal; add `_isLive()` and `_releaseGateAndRepaint()` to GameScene. |
| D-L19 | The Insights player selector is copied in four panels; only one handles a selected player who is no longer in the list. | [src/online/components/LeaderboardPanels/GameTypePerformance.jsx:56](src/online/components/LeaderboardPanels/GameTypePerformance.jsx:56) | Add `usePlayerChoice(names)` and `<PlayerSelect>`, falling back to `names[0]` when the stored name is no longer in the list. |
| D-L20 | Pairwise game loop duplicated between HeadToHeadPanel and RivalryGraph. | [src/online/components/LeaderboardPanels/RivalryGraph.jsx:3](src/online/components/LeaderboardPanels/RivalryGraph.jsx:3) | Add `buildPairStats(games)` to `lib/leaderboard.js`, compute it once in Insights and pass it to both. |
| D-L21 | Lobby.jsx (570 lines) mixes profile/PIN state into the lobby UI; closing the profile sheet keeps `showForm`/`editing`/`editPin`. | [src/online/components/Lobby.jsx:430](src/online/components/Lobby.jsx:430) | Extract `useProfiles()` with a `closeProfileSheet()` that resets all profile state, and move the sheet into `ProfileSheet.jsx`. |
| D-L22 | AdminApp re-implements `soundRegistry.resolveUrl`; its edit inputs are white text on white (2 auditors). | [src/online/components/Admin/AdminApp.jsx:105](src/online/components/Admin/AdminApp.jsx:105) | Export `resolveUrl` and use it. Give the inputs at 171/175 the dark background the other inputs use. The drag/FLIP code can stay. |
| D-L23 | OnlineHistoryTab re-converts online games that gameData has already converted (2 auditors). | [src/score/components/OnlineHistoryTab.jsx:12](src/score/components/OnlineHistoryTab.jsx:12) | Look up the existing `data.online.details` entry by `game_result_id` and delete `convertOnlineGame`. |
| D-L24 | Per-player running totals are summed by hand in 8+ places; ScoreTable's copy has no null guard. | [src/score/components/ScoreTable.jsx:33](src/score/components/ScoreTable.jsx:33) | Add null-safe `totalsByPlayer()`/`cumulativeTotals()` to `utils/scoring.js`. At minimum, guard line 33, because live-sheet rounds come back from the server without validation. |
| D-L25 | Round-entry validation and clamping duplicated in GameTypeSelector and ScoreTable. | [src/score/components/ScoreTable.jsx:98](src/score/components/ScoreTable.jsx:98) | Add `normalizeCount()` and `validateRound()` to `utils/scoring.js` and call them from both. |
| D-L26 | Score analytics pages copy the heat-matrix and award-grid markup. | [src/score/components/GlobalAnalyticsPage.jsx:249](src/score/components/GlobalAnalyticsPage.jsx:249) | Extract `heatClass()` + `<HeatMatrix>` (also used at ComparePlayersPage.jsx:199) and `<AwardsGrid>`. Leave the rest of the page inline. |
| D-L27 | Score App.jsx (423 lines) has an inline reducer that can't be tested. `handleComplete`/`handleRematch` duplicate the save flow, the `localStorage.removeItem` calls do nothing, and "New Game" (398) does the same as "Complete". | [src/score/App.jsx:223](src/score/App.jsx:223) | Move the reducer to `src/score/lib/sheetReducer.js` with tests, write one `finishGame({ rematch })`, drop the removeItem calls, and remove or relabel "New Game". |
| D-L29 | Same selectors defined repeatedly with conflicting values in index.css and game-light.css, leaving several blocks dead. | [src/online/styles/index.css:4120](src/online/styles/index.css:4120) | Merge `.k-detail`, `.k-history`, `.k-used-types` and `.k-sheet.k-drawer`, keeping the later (winning) values. Delete the overridden game-light.css rules, merge duplicate media blocks and drop the unused `--game-*` vars. |
| D-L30 | index.css is a 5,459-line (100 KB) global stylesheet loaded on every King Online route. | [src/online/styles/index.css:1](src/online/styles/index.css:1) | Split it into section partials imported in the same order (no behaviour change). Optionally move game/results/admin CSS into the lazy components, after checking cascade order. |
| D-L31 | Base resets duplicated across Tailwind preflight, index.css and layout.jsx; three different dark canvas colours sit behind light screens (dark band on iOS overscroll). | [app/(online)/layout.jsx:42](<app/(online)/layout.jsx:42>) | Remove the inline `<style>` and the preflight duplicates in index.css:27–63. Pick one canvas colour and keep `themeColor` and the manifest in sync with it. |
| D-L32 | Score main.css pastes the snow-cap SVG twice and repeats the per-theme position rule three times. | [src/score/styles/main.css:1059](src/score/styles/main.css:1059) | Put the data URI in one custom property, and use `body:is(.theme-mountain,.theme-summer,.theme-christmas) :is(.card,.type-btn,.matrix .cell)` for the position rule. |
| D-L33 | The same test harness is copied into eight smoke/test files, all using fixed sleeps. | [server/socket/lobby.smoke.js:20](server/socket/lobby.smoke.js:20) | Move `bracket.test.js` to `node:test`. Add `server/test/harness.js` with `check`, `summary`, `connectClient` and `waitFor`, and use `waitFor` instead of the fixed sleeps. |
| D-L34 | Admin sound routes parse up to 6 MB of body before `requireAdmin`, and DELETE parses a body it never uses. | [app/api/admin/sounds/[id]/route.js:6](app/api/admin/sounds/[id]/route.js:6) | Call `requireAdmin(request)` before `readJson` in the four admin handlers, and drop `readJson` from DELETE. |
| D-L35 | Tournament BracketOverview hand-builds a fixed overlay with no Escape key or focus handling. | [src/online/components/Tournament/BracketOverview.jsx:93](src/online/components/Tournament/BracketOverview.jsx:93) | Render it through `ui/Sheet`, or add Escape handling and focus restore. PinPromptModal already sits inside a Sheet and can stay. |
| D-L37 | Built-in sound list kept in handlers.js, `constants/sounds.js`, `seed.sql` and the dead MySQL `schema.sql` (4 auditors). | [server/socket/handlers.js:32](server/socket/handlers.js:32) | These are frozen fallbacks (the `sounds` table is the source of truth). Delete `server/db/schema.sql` and add a "frozen fallback" comment to the remaining lists. |


---

## Dead code & unused files
Nearly all of it is removed. These are the leftovers.

### Low-severity
| # | Issue | Where | Fix |
|---|---|---|---|
| X-L2 | A knocked-out tournament player still can't reach the bracket: GameOverScreen has no entry point, and the server refuses while their own table is still playing. (The dead `tournament-stop-spectating` handler is gone, and tournament watching now emits `watchers`.) | [src/online/components/GameOverScreen.jsx:238](src/online/components/GameOverScreen.jsx:238) | Add a "watch the bracket" button to GameOverScreen when `tournamentSeat` is set. |
| X-L3 | King Online's manifest has no 512×512 icon, which Chrome's install prompt needs. (The duplicate entry and the score manifest's wrong sizes are fixed.) | [public/manifest.json:11](public/manifest.json:11) | Add a real 512×512 King Online icon to `public/art/` and list it. |
| X-L8 | `profiles.device_key` is still a column (and in the touch trigger and the import script), although nothing writes or reads it any more. | [supabase/migrations/20261012120000_king_online.sql:23](supabase/migrations/20261012120000_king_online.sql:23) | Drop the column in a migration that also updates the trigger and `scripts/import-mysql-dump.mjs`. |
| X-L9 | The server still emits `watchers` to every table, but no client listens any more (the count was never shown). | [server/socket/handlers.js:1045](server/socket/handlers.js:1045) | Either show the watcher count in the HUD, or remove the emits along with the `lobby.smoke.js` asserts. |
| X-L20 | `GameState.players` is saved in every snapshot but every emitter replaces it with `playersView(room.players)`. | [server/game/GameState.js:112](server/game/GameState.js:112) | Before removing `players` from `serialize()`, change the guard in `GameState.fromSnapshot`, or restored rooms come back with no game state. |
| X-L25 | `idx_finished_played_at` serves no query, and the two composite indexes on `finished_games` overlap. | [supabase/migrations/20261012120000_king_online.sql:46](supabase/migrations/20261012120000_king_online.sql:46) | Optional: in a future migration, drop `idx_finished_played_at` and one of the composites. The gain is small. |
