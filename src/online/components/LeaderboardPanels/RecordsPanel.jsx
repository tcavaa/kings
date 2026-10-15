import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { allTimeRecords } from "../../lib/playerStats";
import { getGameType } from "../../constants/gameTypes";
import { formatDuration } from "../../../../shared/duration.js";
import { signed } from "../../utils/format";

const dateOf = (iso) =>
  new Date(iso).toLocaleDateString("ka-GE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

// [key, title, how the value reads, extra line]
const RECORDS = [
  ["highScore", "უმაღლესი ქულა", (r) => signed(r.value)],
  ["lowScore", "ყველაზე დაბალი ქულა", (r) => signed(r.value)],
  ["biggestMargin", "ყველაზე დიდი სხვაობით მოგება", (r) => `+${r.value}`],
  ["closestFinish", "ყველაზე მცირე სხვაობით მოგება", (r) => `+${r.value}`],
  [
    "bestRound",
    "საუკეთესო რაუნდი",
    (r) => signed(r.value),
    (r) => getGameType(r.gameType)?.name,
  ],
  [
    "longestStreak",
    "ყველაზე გრძელი მოგების სერია",
    (r) => `${r.value}`,
    (r) =>
      r.from && r.from !== r.game
        ? `${dateOf(r.from.playedAt)} — ${dateOf(r.game.playedAt)}`
        : null,
  ],
  ["longestGame", "ყველაზე ხანგრძლივი თამაში", (r) => formatDuration(r.value)],
];

/** All-time records over the leaderboard's filter; each opens its game. */
export default function RecordsPanel({ games, onSelectGame }) {
  const rec = useMemo(() => allTimeRecords(games), [games]);
  const shown = RECORDS.filter(([key]) => rec[key]);
  if (!shown.length) return null;
  return (
    <section className="k-analysis-panel k-records-panel">
      <header>
        <div>
          <span className="k-eyebrow">04 / RECORD BOOK</span>
          <h2>რეკორდები</h2>
        </div>
      </header>
      <div className="k-records">
        {shown.map(([key, title, value, extra]) => {
          const r = rec[key];
          const note = extra?.(r);
          return (
            <button
              key={key}
              onClick={() => onSelectGame?.(r.game)}
              disabled={!onSelectGame}
            >
              <span>{title}</span>
              <strong>{value(r)}</strong>
              <b>{r.name || "—"}</b>
              <small>
                {note || dateOf(r.game.playedAt)}
                {" · "}
                {r.game.type === "live" ? "LIVE" : "ONLINE"}
              </small>
              {onSelectGame && <ArrowUpRight size={15} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
