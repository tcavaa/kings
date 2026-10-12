import HeadToHeadPanel from "./HeadToHeadPanel";
import GameTypePerformance from "./GameTypePerformance";
import RivalryGraph from "./RivalryGraph";
import LifetimeCardStats from "./LifetimeCardStats";
import AchievementsPanel from "./AchievementsPanel";
export default function Insights({ games, players }) {
  return (
    <div className="k-insights-grid">
      <HeadToHeadPanel games={games} players={players} />
      <GameTypePerformance games={games} players={players} />
      <RivalryGraph games={games} />
      <LifetimeCardStats players={players} />
      <AchievementsPanel games={games} players={players} />
    </div>
  );
}
