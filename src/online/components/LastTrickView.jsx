import { useGame } from "../context/GameContext";
import PlayingCard from "./ui/PlayingCard";
export default function LastTrickView() {
  const { lastTrickResult, players } = useGame();
  if (!lastTrickResult?.trick)
    return (
      <p className="k-data-empty">პირველი დასრულებული სვლა აქ გამოჩნდება.</p>
    );
  const { trick, winnerSeat } = lastTrickResult;
  return (
    <section className="k-replay">
      <span className="k-eyebrow">TRICK / REPLAY</span>
      <h4>{players.find((p) => p.seat === winnerSeat)?.name}</h4>
      <p>აიღო ბოლო მინუსი</p>
      <div className="k-replay-cards">
        {trick.map(({ seat, card }) => (
          <div key={seat}>
            <PlayingCard card={card} highlight={seat === winnerSeat} />
            <span>{players.find((p) => p.seat === seat)?.name}</span>
            {seat === winnerSeat && <small>მინუსი აიღო</small>}
          </div>
        ))}
      </div>
    </section>
  );
}
