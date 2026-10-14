import { useState } from "react";
import ThreeGame from "./ThreeGame";
const hand = ["AS", "KS", "QS", "JH", "10H", "9D", "8D", "7C", "KC", "AC"].map(
  (s) => ({ rank: s.slice(0, -1), suit: s.slice(-1) }),
);
const initial = {
  roomCode: "DESIGN-ROOM",
  gamePhase: "playing",
  round: 7,
  mySeat: 0,
  leaderSeat: 0,
  currentTurn: 0,
  players: [
    { seat: 0, name: "შენ" },
    { seat: 1, name: "ნიკა" },
    { seat: 2, name: "მარი" },
  ],
  hand,
  cardCounts: { 0: 10, 1: 10, 2: 10 },
  currentTrick: [],
  centerCards: [],
  selectedDiscards: [],
  usedTypes: { 0: [] },
  chosenGameType: "P1",
  trumpSuit: "S",
  cumulativeScores: { 0: -40, 1: 24, 2: 16 },
  roundScores: Array.from({ length: 12 }, (_, i) => ({
    round: i + 1,
    gameType: "K",
    scores: { 0: -40, 1: 0, 2: 0 },
  })),
};
export default function Preview() {
  const [state, setState] = useState(initial);
  const actions = {
    ...state,
    selectGameType: (code) =>
      setState((s) => ({
        ...s,
        chosenGameType: code,
        gamePhase: code.startsWith("P") ? "trump_selection" : "discard",
      })),
    selectTrump: (suit) =>
      setState((s) => ({ ...s, trumpSuit: suit, gamePhase: "discard" })),
    toggleDiscard: (card) =>
      setState((s) => ({
        ...s,
        selectedDiscards: s.selectedDiscards.includes(card)
          ? s.selectedDiscards.filter((c) => c !== card)
          : [...s.selectedDiscards, card],
      })),
    discardCards: (cards) =>
      setState((s) => ({
        ...s,
        hand: s.hand.filter((c) => !cards.includes(c)),
        selectedDiscards: [],
        gamePhase: "playing",
      })),
    playCard: (card) =>
      setState((s) => ({
        ...s,
        hand: s.hand.filter((c) => c !== card),
        currentTrick: [...s.currentTrick, { seat: 0, card }],
        currentTurn: 1,
      })),
    nextRound: () =>
      setState((s) => ({
        ...initial,
        round: s.round + 1,
        gamePhase: "type_selection",
      })),
  };
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <ThreeGame
        gameState={state}
        previewActions={actions}
        onExit={() => location.assign("/")}
        onMenu={() => {}}
        onChat={() => {}}
      />
      <div
        style={{
          position: "absolute",
          top: 75,
          left: 15,
          display: "flex",
          gap: 6,
          zIndex: 5,
        }}
      >
        {[
          "playing",
          "type_selection",
          "trump_selection",
          "discard",
          "round_end",
        ].map((phase) => (
          <button
            style={{
              background: "#183c32",
              color: "#eee",
              padding: 7,
              fontSize: 10,
            }}
            key={phase}
            onClick={() => setState({ ...initial, gamePhase: phase })}
          >
            {phase}
          </button>
        ))}
        <button
          onClick={() =>
            setState({ ...initial, spectator: true, mySeat: null, hand: [] })
          }
        >
          Spectator
        </button>
      </div>
    </div>
  );
}
