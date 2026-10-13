import { useMemo } from "react";
import { useGame } from "../context/GameContext";
import { winProbabilities } from "../../../shared/winProbability.js";

// Same duqani tri-color used by ScoreChart, indexed by sorted seat order.
const COLORS = ["#d7fa52", "#afbf9b", "#6e8672"];

/**
 * Live win-probability bars for the current game. The model (how far the
 * scores can still move in the rounds left) is shared with ჩაწერა's sheet:
 * see shared/winProbability.js.
 */
export default function WinProbability() {
  const { players, roundScores, roundDetails, cumulativeScores } = useGame();
  const rounds =
    roundDetails && roundDetails.length ? roundDetails : roundScores;

  const probs = useMemo(() => {
    if (!players || players.length === 0) return [];
    const sorted = [...players].sort((a, b) => a.seat - b.seat);
    const chances = winProbabilities(
      sorted.map((p) => cumulativeScores?.[p.seat] ?? 0),
      rounds.map((r) => r.gameType),
    );
    return sorted.map((p, i) => ({
      player: p,
      prob: chances[i],
      color: COLORS[i % COLORS.length],
    }));
  }, [players, rounds, cumulativeScores]);

  if (!probs.length || rounds.length === 0) return null;

  return (
    <section className="k-probability">
      <h3>თამაშის ბალანსი</h3>
      <p>მიახლოებითი შეფასება დარჩენილი ქულების მიხედვით</p>
      {probs.map(({ player, prob, color }) => (
        <div key={player.seat}>
          <span>{player.name}</span>
          <div>
            <i style={{ width: `${prob * 100}%`, background: color }} />
          </div>
          <b>{Math.round(prob * 100)}%</b>
        </div>
      ))}
    </section>
  );
}
