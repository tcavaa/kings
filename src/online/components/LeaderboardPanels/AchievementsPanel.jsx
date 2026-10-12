import { useMemo, useState } from "react";
import AchievementBadges from "../AchievementBadges";
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
  const [selected, setSelected] = useState("");
  const names = Array.from(
    new Set([...players.map((p) => p.name), ...Object.keys(lifetime)]),
  );
  const name = playerName ?? (names.includes(selected) ? selected : names[0]);
  const achievements = lifetime[name] || {};
  const count = Object.values(achievements).filter((v) => v > 0).length;
  return (
    <section className="k-analysis-panel k-achievement-panel">
      <header>
        <div>
          <span className="k-eyebrow">05 / THE COLLECTION</span>
          <h2>მიღწევების კოლექცია</h2>
        </div>
        {!playerName && (
          <select
            aria-label="მოთამაშის მიღწევები"
            value={name || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
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
