import { useMemo } from "react";
import AchievementBadges from "../AchievementBadges";
import PlayerSelect, { usePlayerChoice } from "./PlayerSelect";
import {
  computeAllLifetimeAchievements,
  ACHIEVEMENT_DEFS,
} from "../../utils/achievements";
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
  const name = playerName ?? chosen;
  const achievements = lifetime[name] || {};
  const count = Object.values(achievements).filter((v) => v > 0).length;
  return (
    <section className="k-analysis-panel k-achievement-panel">
      <header>
        <div>
          <span className="k-eyebrow">06 / THE COLLECTION</span>
          <h2>მიღწევების კოლექცია</h2>
        </div>
        {!playerName && (
          <PlayerSelect
            label="მოთამაშის მიღწევები"
            names={names}
            value={name || ""}
            onChange={setChosen}
          />
        )}
      </header>
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
      <AchievementBadges achievements={achievements} showLocked />
    </section>
  );
}
