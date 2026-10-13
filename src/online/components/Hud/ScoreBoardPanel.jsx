import { memo } from "react";
import { ArrowUpRight } from "lucide-react";
import { useGame } from "../../context/GameContext";
function ScoreBoardPanel({ onOpen }) {
  const { players, cumulativeScores, mySeat } = useGame();
  return (
    <button
      className="k-live-scores"
      onClick={onOpen}
      aria-label="ქულების დეტალები"
    >
      <span className="k-live-scores-title">
        LIVE STANDINGS <ArrowUpRight size={13} />
      </span>
      {[...players]
        .sort(
          (a, b) =>
            (cumulativeScores[b.seat] || 0) - (cumulativeScores[a.seat] || 0),
        )
        .map((p, i) => (
          <span
            className={`k-live-score ${p.seat === mySeat ? "own" : ""}`}
            key={p.seat}
          >
            <small>{i + 1}</small>
            <span>{p.name}</span>
            <b
              data-score-sign={
                (cumulativeScores[p.seat] || 0) > 0
                  ? "positive"
                  : (cumulativeScores[p.seat] || 0) < 0
                    ? "negative"
                    : "zero"
              }
            >
              {(cumulativeScores[p.seat] || 0) > 0 ? "+" : ""}
              {cumulativeScores[p.seat] || 0}
            </b>
          </span>
        ))}
    </button>
  );
}
export default memo(ScoreBoardPanel);
