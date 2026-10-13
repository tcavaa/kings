import { useMemo } from "react";
import { GAME_TYPES, getGameType } from "../../constants/gameTypes";
import PlayerSelect, { usePlayerChoice } from "./PlayerSelect";

/**
 * Per-game-type performance for the chosen player.
 *
 * For each of the 9 game types we average their score across every game
 * they've played, plus track best/worst single-round score in that type.
 */
function buildPerf(games, playerName) {
  const perType = {};
  for (const code of GAME_TYPES.map((t) => t.code)) {
    perType[code] = {
      code,
      count: 0,
      total: 0,
      best: -Infinity,
      worst: Infinity,
    };
  }
  for (const g of games) {
    const me = (g.players || []).find((p) => p.name === playerName);
    if (!me) continue;
    for (const d of g.roundDetails || []) {
      const code = d.gameType;
      if (!perType[code]) continue;
      const s = d.scores?.[me.seat] ?? 0;
      perType[code].count += 1;
      perType[code].total += s;
      if (s > perType[code].best) perType[code].best = s;
      if (s < perType[code].worst) perType[code].worst = s;
    }
  }
  return Object.values(perType)
    .filter((t) => t.count > 0)
    .map((t) => ({ ...t, avg: t.total / t.count }));
}

export default function GameTypePerformance({ games, players }) {
  const names = useMemo(() => players.map((p) => p.name), [players]);
  const [me, setMe] = usePlayerChoice(names);
  const rows = useMemo(() => buildPerf(games, me), [games, me]);

  const sorted = useMemo(() => [...rows].sort((a, b) => b.avg - a.avg), [rows]);

  if (!players.length) return null;

  return (
    <section className="k-analysis-panel">
      <header>
        <div>
          <span className="k-eyebrow">02 / PERFORMANCE</span>
          <h2>შედეგები ტიპების მიხედვით</h2>
        </div>
        <PlayerSelect
          label="მოთამაშის შედეგები"
          names={names}
          value={me}
          onChange={setMe}
        />
      </header>
      {!sorted.length ? (
        <p className="k-data-empty">
          დასრულებული რაუნდების მონაცემები აქ გამოჩნდება.
        </p>
      ) : (
        <div className="k-performance-list">
          {sorted.map((r) => (
            <div key={r.code}>
              <span className="k-type-code">{r.code}</span>
              <div>
                <strong>{getGameType(r.code)?.name}</strong>
                <small>
                  {r.count} რაუნდი · დიაპაზონი {r.worst} / {r.best}
                </small>
              </div>
              <div>
                <b className={r.avg < 0 ? "is-negative" : "is-positive"}>
                  {r.avg > 0 ? "+" : ""}
                  {Math.round(r.avg * 10) / 10}
                </b>
                <small>საშუალო</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
