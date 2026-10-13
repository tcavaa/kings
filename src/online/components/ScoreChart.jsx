import { useMemo } from "react";
import { useGame } from "../context/GameContext";
import ProgressionChart from "./LeaderboardPanels/ProgressionChart";

/** The current game's running totals, round by round. */
export default function ScoreChart() {
  const { roundScores, players } = useGame();

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.seat - b.seat),
    [players],
  );
  const rows = useMemo(() => {
    const running = {};
    return roundScores.map((rs) => {
      const point = { round: rs.round };
      sortedPlayers.forEach((p) => {
        running[p.seat] = (running[p.seat] ?? 0) + (rs.scores?.[p.seat] ?? 0);
        point[p.seat] = running[p.seat];
      });
      return point;
    });
  }, [roundScores, sortedPlayers]);

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
