import { useMemo } from "react";
import HeadToHeadPanel from "./HeadToHeadPanel";
import GameTypePerformance from "./GameTypePerformance";
import RivalryGraph from "./RivalryGraph";
import LifetimeCardStats from "./LifetimeCardStats";
import AchievementsPanel from "./AchievementsPanel";
import RecordsPanel from "./RecordsPanel";
import { buildPairStats } from "../../lib/leaderboard";
export default function Insights({
  games,
  players,
  gameType = "all",
  onSelectGame,
}) {
  const pairs = useMemo(() => buildPairStats(games), [games]);
  return (
    <div className="k-insights-grid">
      <HeadToHeadPanel pairs={pairs} players={players} />
      <GameTypePerformance games={games} players={players} />
      <RivalryGraph pairs={pairs} />
      <LifetimeCardStats players={players} gameType={gameType} />
      <RecordsPanel games={games} onSelectGame={onSelectGame} />
      <AchievementsPanel games={games} players={players} />
    </div>
  );
}
