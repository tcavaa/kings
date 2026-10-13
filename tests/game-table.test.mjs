import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { isPlayableCard } from "../src/online/game/lib/playable.js";
import {
  layoutFor,
  isPortraitBox,
  sceneSize,
  handScale,
  handSlots,
  relSeat,
} from "../src/online/game/layout.js";
import { isFreshDeal, dealRecord } from "../src/online/game/lib/dealMemory.js";

const require = createRequire(import.meta.url);
const GameState = require("../server/game/GameState.js");
const { canDiscard } = require("../server/game/rules.js");

const SUITS = ["H", "D", "S", "C"];
const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const DECK = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
const TYPES = ["K", "Q", "J", "H", "L2", "T", "P1", "P2", "P3"];

// mulberry32: the same random positions on every run.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("the table greys out exactly the cards the server would reject", () => {
  const random = rng(7);
  const pick = (list) => list[Math.floor(random() * list.length)];
  let checked = 0;
  for (let n = 0; n < 3000; n++) {
    const deck = [...DECK].sort(() => random() - 0.5);
    const hand = deck.slice(0, 1 + Math.floor(random() * 10));
    const trickLen = Math.floor(random() * 3); // the server never sees 3
    const currentTrick = deck
      .slice(10, 10 + trickLen)
      .map((card, i) => ({ seat: i + 1, card }));
    const chosenGameType = pick(TYPES);
    const trumpSuit = random() < 0.7 ? pick(SUITS) : null;
    const ledSuit = currentTrick[0]?.card.suit ?? null;
    const view = {
      phase: "playing",
      currentTurn: 0,
      hands: { 0: hand },
      currentTrick,
      chosenGameType,
      ledSuit,
      trumpSuit,
    };
    for (const card of hand) {
      const server = GameState.prototype.validatePlay.call(view, 0, card).valid;
      const client = isPlayableCard(card, {
        gamePhase: "playing",
        currentTurn: 0,
        mySeat: 0,
        hand,
        currentTrick,
        ledSuit,
        chosenGameType,
        trumpSuit,
      });
      assert.equal(client, server, JSON.stringify({ card, view }));
      checked++;
    }
  }
  assert.ok(checked > 10000);
});

test("a finished trick still on the table means the next card leads", () => {
  const hand = [
    { rank: "7", suit: "H" },
    { rank: "8", suit: "S" },
  ];
  const state = {
    gamePhase: "playing",
    currentTurn: 1,
    mySeat: 1,
    hand,
    chosenGameType: "H",
    ledSuit: "H",
    currentTrick: [0, 1, 2].map((seat) => ({ seat, card: { rank: "A", suit: "H" } })),
  };
  // Leading in the hearts round: no heart while other suits are held.
  assert.equal(isPlayableCard(hand[0], state), false);
  assert.equal(isPlayableCard(hand[1], state), true);
});

test("nothing is playable off-turn, while a play is pending or a trick is flying", () => {
  const card = { rank: "7", suit: "S" };
  const base = { gamePhase: "playing", currentTurn: 0, mySeat: 0, hand: [card], currentTrick: [] };
  assert.equal(isPlayableCard(card, base), true);
  assert.equal(isPlayableCard(card, { ...base, currentTurn: 1 }), false);
  assert.equal(isPlayableCard(card, { ...base, playPending: true }), false);
  assert.equal(isPlayableCard(card, { ...base, trickAnimation: { status: "showing" } }), false);
  assert.equal(isPlayableCard(card, { ...base, gamePhase: "discard" }), false);
});

test("discard rules", () => {
  assert.equal(canDiscard("K", { rank: "7", suit: "H" }), false);
  assert.equal(canDiscard("Q", { rank: "Q", suit: "S" }), false);
  assert.equal(canDiscard("J", { rank: "J", suit: "D" }), false);
  assert.equal(canDiscard("P1", { rank: "K", suit: "H" }), true);
});

test("layouts: the tall table for upright boxes, scene size without the top band", () => {
  assert.equal(isPortraitBox(400, 800), true);
  assert.equal(isPortraitBox(800, 400), false);
  assert.deepEqual(sceneSize(layoutFor(false)), { width: 1100, height: 645 });
  assert.deepEqual(sceneSize(layoutFor(true)), { width: 720, height: 1240 });
  assert.equal(relSeat(2, 0), 2);
  assert.equal(relSeat(0, 2), 1);
  assert.equal(relSeat(1, null), 1);
});

test("hand: one fanned row on the wide table, two rows on the tall one", () => {
  const wide = layoutFor(false);
  const tall = layoutFor(true);
  assert.equal(handScale(wide, 1), 1);
  assert.equal(handScale(wide, 0.3), 1.3);
  assert.equal(handScale(tall, 0.3), 1.5);

  const row = handSlots(wide, 10, 1, false);
  assert.equal(row.length, 10);
  assert.equal(new Set(row.map((s) => Math.round(s.y * 100))).size > 1, true);
  // Symmetric about the middle of the table.
  assert.ok(Math.abs(row[0].x + row[9].x - wide.W) < 1e-9);

  const rows = handSlots(tall, 9, 1.5, false);
  assert.equal(rows.length, 9);
  assert.equal(new Set(rows.slice(0, 5).map((s) => Math.round(s.y - Math.abs(s.angle) / 0.6))).size, 1);
  assert.ok(rows[5].y > rows[0].y);
});

test("a fresh deal is told apart from the same hand shown again", () => {
  const deal = DECK.slice(0, 10);
  const record = dealRecord(deal, 3);
  assert.equal(isFreshDeal(deal, 3, null), true);
  assert.equal(isFreshDeal(deal, 3, record), false);
  // After playing a card, or as the leader holding the 2 centre cards.
  assert.equal(isFreshDeal(deal.slice(1), 3, record), false);
  assert.equal(isFreshDeal([...deal, ...DECK.slice(10, 12)], 3, record), false);
  // The next round, or a new game's round with the same number.
  assert.equal(isFreshDeal(deal, 4, record), true);
  assert.equal(isFreshDeal(DECK.slice(20, 30), 3, record), true);
  // Mid-round hands are never a deal.
  assert.equal(isFreshDeal(DECK.slice(0, 8), 5, record), false);
});
