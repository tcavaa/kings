import { useMemo, useState } from "react";
import AchievementBadges from "../AchievementBadges";
import ClubAchievements from "./ClubAchievements";
import PlayerSelect, { usePlayerChoice } from "./PlayerSelect";
import {
  computeAllLifetimeAchievements,
  clubAchievementStats,
  ACHIEVEMENT_DEFS,
} from "../../utils/achievements";
const VIEWS = [
  ["player", "მოთამაშე"],
  ["club", "კლუბი"],
];
export default function AchievementsPanel({
  games = [],
  players = [],
  playerName,
}) {
  const lifetime = useMemo(
    () => computeAllLifetimeAchievements(games),
    [games],
  );
  // Ranked players only: removed ჩაწერა players still have badges in
  // `lifetime`, but appear nowhere else.
  const names = useMemo(() => players.map((p) => p.name), [players]);
  const [chosen, setChosen] = usePlayerChoice(names);
  const [view, setView] = useState("player");
  // The club view needs every ranked player's games, so a profile (one
  // player's games only) shows just their own collection.
  const club = useMemo(
    () => (playerName ? null : clubAchievementStats(games, names)),
    [games, names, playerName],
  );
  const rarity = useMemo(
    () => club && Object.fromEntries(club.badges.map((b) => [b.code, b])),
    [club],
  );
  const name = playerName ?? chosen;
  const achievements = lifetime[name] || {};
  const count = Object.values(achievements).filter((v) => v > 0).length;
  const showClub = club && view === "club";
  return (
    <section className="k-analysis-panel k-achievement-panel">
      <header>
        <div>
          <span className="k-eyebrow">06 / THE COLLECTION</span>
          <h2>მიღწევების კოლექცია</h2>
        </div>
        {!playerName && (
          <div className="k-achievement-controls">
            <div className="k-segmented" role="group" aria-label="ვისი მიღწევები">
              {VIEWS.map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {!showClub && (
              <PlayerSelect
                label="მოთამაშის მიღწევები"
                names={names}
                value={name || ""}
                onChange={setChosen}
              />
            )}
          </div>
        )}
      </header>
      {showClub ? (
        <ClubAchievements stats={club} players={players} />
      ) : (
        <>
          <div className="k-collection-heading">
            <strong>
              {String(count).padStart(2, "0")}
              <small> / {Object.keys(ACHIEVEMENT_DEFS).length}</small>
            </strong>
            <p>
              შენი თამაშის ხელწერა.
              <br />
              თითოეული მიღწევა — ახალი ეტაპი.
            </p>
          </div>
          <AchievementBadges
            achievements={achievements}
            showLocked
            rarity={rarity}
          />
        </>
      )}
    </section>
  );
}
