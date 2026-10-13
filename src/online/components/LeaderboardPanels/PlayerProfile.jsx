import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft } from "lucide-react-online";
import AvatarImg from "../AvatarImg";
import AchievementsPanel from "./AchievementsPanel";
import PastGamesList from "./PastGamesList";
import { signed, winRate, averageScore } from "../../utils/format";

export default function PlayerProfile({
  player,
  rank,
  games,
  onBack,
  onSelectGame,
}) {
  const heading = useRef(null);
  const matches = useMemo(
    () =>
      games
        .filter((g) => g.players?.some((p) => p.name === player.name))
        .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)),
    [games, player.name],
  );
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current
      ?.closest(".k-player-profile")
      ?.scrollIntoView({ block: "start" });
  }, [player.name]);
  const stats = [
    ["თამაში", player.gamesPlayed],
    ["გამარჯვება", player.wins],
    ["მოგების მაჩვენებელი", `${winRate(player)}%`],
    ["ჯამური ქულა", signed(player.totalScore)],
    ["საუკეთესო შედეგი", signed(player.bestScore)],
    ["საშუალო ქულა", signed(averageScore(player))],
  ];
  return (
    <section className="k-player-profile">
      <button className="k-profile-back" onClick={onBack}>
        <ArrowLeft size={18} /> უკან რეიტინგზე
      </button>
      <header className="k-profile-identity">
        <AvatarImg avatar={player.avatar} size={96} />
        <div>
          <span className="k-eyebrow">
            PLAYER / {String(rank).padStart(2, "0")}
          </span>
          <h2 ref={heading} tabIndex={-1}>
            {player.name}
          </h2>
          <p>მოთამაშის პროფილი</p>
        </div>
        <span className="k-profile-rank">
          #{String(rank).padStart(2, "0")}
          <small>რეიტინგში</small>
        </span>
      </header>
      <dl className="k-profile-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <AchievementsPanel games={matches} playerName={player.name} />
      <section className="k-profile-history">
        <header>
          <span className="k-eyebrow">RECENT PLAY</span>
          <h2>ბოლო თამაშები</h2>
          <p>
            ბოლო {Math.min(matches.length, 6)} თამაში · სულ {matches.length}
          </p>
        </header>
        <PastGamesList games={matches.slice(0, 6)} onSelect={onSelectGame} />
      </section>
    </section>
  );
}
