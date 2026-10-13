import { useMemo } from "react";
import { useGame } from "../context/GameContext";
import ProgressionChart from "./LeaderboardPanels/ProgressionChart";
import { runningTotals } from "../../../shared/totals.js";

/** The current game's running totals, round by round. */
export default function ScoreChart() {
  const { roundScores, players } = useGame();

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.seat - b.seat),
    [players],
  );
  const rows = useMemo(
    () =>
      runningTotals(sortedPlayers.map((p) => p.seat), roundScores).map(
        (totals, i) => ({ round: roundScores[i].round, ...totals }),
      ),
    [roundScores, sortedPlayers],
  );

  if (!players.length || roundScores.length === 0)
    return (
      <p className="k-data-empty">
        გრაფიკი პირველი დასრულებული რაუნდის შემდეგ გამოჩნდება.
      </p>
    );

  return (
    <div className="k-chart-panel">
      <p className="k-data-caption">ჯამური ქულა ყოველი რაუნდის შემდეგ</p>
      <ProgressionChart
        rows={rows}
        players={sortedPlayers}
        height={200}
        className=""
      />
    </div>
  );
}
