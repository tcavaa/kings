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
  const progression = useMemo(() => {
    const running = {};
    playerList.forEach((p) => (running[p.seat] = 0));
    return details.map((d) => {
      const point = { round: d.round };
      playerList.forEach((p) => {
        running[p.seat] = (running[p.seat] || 0) + (d.scores?.[p.seat] ?? 0);
        point[p.seat] = running[p.seat];
      });
      return point;
    });
  }, [details, playerList]);

  // Per-player stats — only count items in the rounds where they actually
  // mattered (queens during 'Q' rounds, K♥ during 'K', etc.) so totals can
  // never exceed the in-game maximums (3 K♥ events, 12 queens, 12 jacks,
  // 24 hearts across a full game).
  const stats = useMemo(() => {
    const tally = {};
    playerList.forEach((p) => {
      tally[p.seat] = {
        roundsLed: 0,
        totalTricks: 0,
        queens: 0,
        jacks: 0,
        hearts: 0,
        kingsOfHearts: 0,
      };
    });
    details.forEach((d) => {
      if (tally[d.leaderSeat]) tally[d.leaderSeat].roundsLed++;
      for (const { seat } of playerList) {
        if (!tally[seat]) continue;
        tally[seat].totalTricks += d.tricksTaken?.[seat] ?? 0;
        if (d.gameType === "Q")
          tally[seat].queens += d.queensTaken?.[seat] ?? 0;
        if (d.gameType === "J") tally[seat].jacks += d.jacksTaken?.[seat] ?? 0;
        if (d.gameType === "H")
          tally[seat].hearts += d.heartsTaken?.[seat] ?? 0;
        if (d.gameType === "K" && d.kingOfHeartsTakenBy === seat)
          tally[seat].kingsOfHearts++;
      }
    });
    return tally;
  }, [details, playerList]);

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
