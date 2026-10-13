// Which hand cards the table lets you click. The card rules themselves are
// the server's own (server/game/rules.js), so the table can never grey out a
// different set of cards than the server would reject.
import { playError } from "../../../../server/game/rules.js";

export function isPlayableCard(card, state) {
  const {
    currentTurn,
    mySeat,
    gamePhase,
    currentTrick,
    ledSuit,
    chosenGameType,
    trumpSuit,
    hand,
    trickAnimation,
    playPending,
  } = state;
  if (gamePhase !== "playing") return false;
  if (currentTurn !== mySeat) return false;
  // Lock interaction while the just-completed trick is being revealed/animated.
  if (trickAnimation) return false;
  // Lock the entire hand the moment the user has clicked a card and the
  // server hasn't yet acked. Stops rapid-fire clicks from optimistically
  // removing additional cards before the first round-trip completes.
  if (playPending) return false;

  // A finished 3-card trick still on the table means the next card leads.
  const leading =
    !currentTrick || currentTrick.length === 0 || currentTrick.length === 3;
  return !playError(card, {
    hand,
    leading,
    ledSuit,
    chosenGameType,
    trumpSuit,
  });
}
