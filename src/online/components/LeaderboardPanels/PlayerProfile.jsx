import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import AvatarImg from "../AvatarImg";
import AchievementsPanel from "./AchievementsPanel";
import PastGamesList from "./PastGamesList";
import FormGuide, { RESULT_LABELS } from "./FormGuide";
import { recentForm, streaksOf } from "../../lib/playerStats";
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
  const form = useMemo(
    () => recentForm(matches, player.name, 10),
    [matches, player.name],
  );
  const streaks = useMemo(
    () => streaksOf(matches, player.name),
    [matches, player.name],
  );
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
        <AvatarImg avatar={player.avatar} name={player.name} size={96} />
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
      <section className="k-profile-form">
        <header>
          <span className="k-eyebrow">FORM / LAST {form.length}</span>
          <h2>ფორმა</h2>
        </header>
        <FormGuide
          form={form}
          name={player.name}
          onSelectGame={onSelectGame}
          size="lg"
        />
        <dl>
          <div>
            <dt>მიმდინარე სერია</dt>
            <dd>
              {streaks.current ? (
                <>
                  {streaks.current.length}
                  <small>{RESULT_LABELS[streaks.current.result]}</small>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>საუკეთესო მოგების სერია</dt>
            <dd>{streaks.longestWin}</dd>
          </div>
          <div>
            <dt>ყველაზე გრძელი წაგების სერია</dt>
            <dd>{streaks.longestLoss}</dd>
          </div>
        </dl>
      </section>
      {/* Every game: breaking someone's streak needs their games too. */}
      <AchievementsPanel games={games} playerName={player.name} />
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
