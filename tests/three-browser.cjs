// Run with an isolated dev server: NEXT_PUBLIC_SOCKET_URL=http://127.0.0.1:3101 npm run dev -- --port 3100
const root = require("node:path").resolve(__dirname, "..");
const { chromium } = require("@playwright/test");
const { Server } = require(root + "/server/node_modules/socket.io");
const GameState = require(root + "/server/game/GameState");
const { canDiscard } = require(root + "/server/game/rules");
const assert = require("node:assert/strict");
const http = require("node:http");
const server = http.createServer();
const io = new Server(server, { cors: { origin: "*" } });
const game = new GameState();
const sockets = [];
let failures = [];
const players = [
  { seat: 0, name: "Test Player", connected: true },
  { seat: 1, name: "Nika", connected: true },
  { seat: 2, name: "Mari", connected: true },
];
const snapshot = () =>
  sockets.forEach(
    (s, i) =>
      s?.connected &&
      s.emit("game-state", {
        ...game.getStateForPlayer(i),
        players,
        roomCode: "3DTEST",
      }),
  );
function result(r) {
  if (!r.ok) {
    failures.push(r.error);
    throw new Error(r.error);
  }
  snapshot();
}
io.on("connection", (socket) => {
  const seat = sockets.length;
  sockets.push(socket);
  if (seat > 2) return;
  socket.emit("room-joined", {
    roomCode: "3DTEST",
    seat,
    reconnected: true,
    status: "playing",
  });
  socket.emit("game-started", {
    round: 1,
    leaderSeat: 0,
    players,
    startedAt: Date.now(),
  });
  snapshot();
  socket.on("request-state", snapshot);
  socket.on("select-game-type", ({ typeCode }) =>
    result(game.selectGameType(seat, typeCode)),
  );
  socket.on("select-trump", ({ suit }) => result(game.selectTrump(seat, suit)));
  socket.on("discard-cards", ({ cards }) =>
    result(game.discardCards(seat, cards)),
  );
  socket.on("next-round", () => {
    game.startNextRound();
    snapshot();
  });
  socket.on("play-card", ({ card }) => {
    const r = game.playCard(seat, card);
    if (!r.ok) {
      failures.push(r.error);
      socket.emit("error", { message: r.error });
      return;
    }
    if (r.trickComplete) {
      sockets.forEach((s) =>
        s.emit(r.roundEnds ? "round-complete" : "trick-complete", {
          ...r,
          nextTurn: game.currentTurn,
          cardCounts: game.cardCounts(),
        }),
      );
    } else
      sockets.forEach((s) =>
        s.emit("card-played", {
          seat,
          card,
          currentTrick: game.currentTrick,
          currentTurn: game.currentTurn,
          ledSuit: game.ledSuit,
          cardCounts: game.cardCounts(),
        }),
      );
  });
});
(async () => {
  await new Promise((r) => server.listen(3101, "127.0.0.1", r));
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-webgl", "--use-angle=gl"],
  });
  const contexts = [],
    pages = [];
  const errors = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({
      viewport: { width: 1365, height: 850 },
    });
    contexts.push(ctx);
    await ctx.addInitScript(() => localStorage.setItem("king:view-mode", "3d"));
    const page = await ctx.newPage();
    pages.push(page);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await page.goto("http://localhost:3100/");
    await page
      .getByRole("button", { name: "2D რეჟიმი", exact: true })
      .waitFor({ timeout: 45000 });
    await page.getByRole("button", { name: "კონტროლები", exact: true }).click();
  }
  const panel = (p) =>
    p.getByRole("complementary", { name: "თამაშის კონტროლები" });
  await panel(pages[0])
    .getByRole("button", { name: "P1 პლიუსი 1", exact: true })
    .click();
  await panel(pages[0])
    .getByRole("button", { name: "დავიწყოთ", exact: true })
    .click();
  await panel(pages[0])
    .getByRole("button", { name: "♠", exact: true })
    .click();
  await panel(pages[0])
    .getByRole("button", { name: "დადასტურება", exact: true })
    .click();
  const legal = game.hands[0].filter((c) => canDiscard(game.chosenGameType, c));
  const same = (a, b) => a.rank === b.rank && a.suit === b.suit;
  let picked;
  for (const a of legal)
    for (const b of legal)
      if (
        !same(a, b) &&
        !(
          game.lastCenterCards.some((c) => same(c, a)) &&
          game.lastCenterCards.some((c) => same(c, b))
        )
      )
        picked = [a, b];
  const suit = { S: "♠", H: "♥", D: "♦", C: "♣" };
  for (const c of picked)
    await panel(pages[0])
      .getByRole("button", { name: c.rank + suit[c.suit], exact: true })
      .click();
  await panel(pages[0])
    .getByRole("button", { name: "გადადება", exact: true })
    .click();
  assert.equal(game.phase, "playing");
  console.log(
    "PASS three browser clients: selection/trump/discards accepted by actual server engine",
  );
  // Play the full round through visible controls; server events drive card/trick animations.
  let plays = 0;
  while (game.phase === "playing" && plays < 31) {
    const seat = game.currentTurn;
    const card = game.hands[seat].find((c) => game.validatePlay(seat, c).valid);
    await panel(pages[seat])
      .getByRole("button", { name: card.rank + suit[card.suit], exact: true })
      .click({ timeout: 15000 });
    plays++;
    console.log(`  card ${plays}/30 accepted`);
  }
  assert.equal(game.phase, "round_end");
  assert.equal(plays, 30);
  console.log(
    "PASS all 30 legal card plays, ten trick animations and round scoring",
  );
  await panel(pages[0])
    .getByRole("button", { name: "შემდეგი ხელი", exact: true })
    .waitFor({ timeout: 10000 });
  await pages[0]
    .getByRole("button", { name: "კონტროლები", exact: true })
    .click();
  await pages[0]
    .getByRole("button", { name: "2D რეჟიმი", exact: true })
    .click();
  await pages[0]
    .getByRole("button", { name: "3D რეჟიმი", exact: true })
    .waitFor();
  await pages[0]
    .getByRole("button", { name: "3D რეჟიმი", exact: true })
    .click();
  await pages[0]
    .getByRole("button", { name: "კონტროლები", exact: true })
    .click();
  await panel(pages[0])
    .getByRole("button", { name: "შემდეგი ხელი", exact: true })
    .click();
  assert.equal(game.round, 2);
  assert.equal(game.leaderSeat, 1);
  await panel(pages[1])
    .getByRole("button", { name: "K კინგი", exact: true })
    .waitFor();
  console.log("PASS 3D → 2D → 3D preserves round and advances next leader");
  await pages[0]
    .getByRole("button", { name: "კონტროლები", exact: true })
    .click();
  await pages[0].screenshot({ path: "/tmp/kings-3d-live.png" });
  assert.deepEqual(failures, []);
  assert.deepEqual(errors, []);
  console.log("PASS no browser exceptions or rejected game actions");
  await browser.close();
  io.close();
  server.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
