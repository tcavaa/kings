import { useMemo, useState, lazy, Suspense } from "react";
import { ArrowLeft } from "lucide-react-online";
import PodiumView from "./PodiumView";
import PlayerStatsCards from "./PlayerStatsCards";
import RoundBreakdownTable from "./RoundBreakdownTable";
import ProgressionTable from "./ProgressionTable";
const ProgressionChart = lazy(() => import("./ProgressionChart"));
import AchievementBadges from "../AchievementBadges";
import { GameModeTag } from "./PastGamesList";
import {
  computePerGameAchievements,
  countCodes,
} from "../../utils/achievements";
import { computeGameStats } from "../../utils/gameStats";
import { runningTotals } from "../../../../shared/totals.js";

/** Detail page for one finished game. */
export default function GameDetail({ game, onBack }) {
  const [tab, setTab] = useState("overview");
  const sortedPlayers = useMemo(
    () =>
      [...(game.players || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [game],
  );
  const playerList = useMemo(
    () => [...(game.players || [])].sort((a, b) => a.seat - b.seat),
    [game.players],
  );
  const details = game.roundDetails || [];

  // Running cumulative score per round.
  const progression = useMemo(
    () =>
      runningTotals(playerList.map((p) => p.seat), details).map((totals, i) => ({
        round: details[i].round,
        ...totals,
      })),
    [details, playerList],
  );

  // Per-player stats, by the per-round-type rule (see utils/gameStats).
  const stats = useMemo(
    () => computeGameStats(playerList, details),
    [details, playerList],
  );

  const achievements = useMemo(
    () => computePerGameAchievements(playerList, details),
    [playerList, details],
  );
  const achieversList = playerList.filter(
    (p) => (achievements[p.seat] || []).length > 0,
  );

  return (
    <div className="k-history-report">
      <div className="k-report-toolbar">
        <button className="k-text-action" onClick={onBack}>
          <ArrowLeft size={16} /> ყველა თამაში
        </button>
        <GameModeTag isChampionship={game.isChampionship} type={game.type} />
      </div>
      <PodiumView game={game} sortedPlayers={sortedPlayers} />
      <nav className="k-report-tabs" aria-label="თამაშის დეტალები">
        {[
          ["overview", "შეჯამება"],
          ["rounds", "რაუნდები"],
          ["progress", "პროგრესი"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <>
          <PlayerStatsCards playerList={playerList} stats={stats} />
          {achieversList.length > 0 && (
            <section className="k-report-achievements">
              <h3>მიღწევები ამ თამაშში</h3>
              {achieversList.map((p) => (
                <div key={p.seat}>
                  <h4>{p.name}</h4>
                  <AchievementBadges
                    achievements={countCodes(achievements[p.seat] || [])}
                  />
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {tab === "rounds" && (
        <RoundBreakdownTable details={details} playerList={playerList} />
      )}
      {tab === "progress" && (
        <section className="k-report-progress">
          {progression.length >= 2 && (
            <Suspense fallback={<p className="k-data-empty">იტვირთება…</p>}>
              <ProgressionChart rows={progression} players={playerList} />
            </Suspense>
          )}
          <ProgressionTable rows={progression} players={playerList} />
        </section>
      )}
    </div>
  );
}
