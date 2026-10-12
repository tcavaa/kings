import { useMemo, useState } from "react";
import { winnersOf, isWinnerName } from "../../lib/leaderboard";
function buildPairData(games) {
  // pair-key (sorted names) -> { label, [nameA]: aWins, [nameB]: bWins }
  const map = new Map();
  for (const g of games) {
    const players = g.players || [];
    if (players.length < 2 || !winnersOf(g).length) continue;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const A = players[i].name,
          B = players[j].name;
        const [first, second] = [A, B].sort();
        const key = `${first}|${second}`;
        const row = map.get(key) || {
          pair: `${first} vs ${second}`,
          [first]: 0,
          [second]: 0,
        };
        // Tie-aware: a shared top score credits both sides of the pair.
        if (isWinnerName(g, first)) row[first] = (row[first] || 0) + 1;
        if (isWinnerName(g, second)) row[second] = (row[second] || 0) + 1;
        map.set(key, row);
      }
    }
  }
  return Array.from(map.values());
}

export default function RivalryGraph({ games }) {
  const data = useMemo(() => buildPairData(games), [games]);
  const [limit, setLimit] = useState(6);
  return (
    <section className="k-analysis-panel">
      <header>
        <div>
          <span className="k-eyebrow">03 / RIVALRIES</span>
          <h2>მეტოქეობა</h2>
        </div>
        <span className="k-muted">{data.length} წყვილი</span>
      </header>
      <div className="k-rivalries">
        {data.slice(0, limit).map((r) => {
          const [a, b] = Object.keys(r).filter((k) => k !== "pair");
          const total = r[a] + r[b];
          return (
            <div key={r.pair}>
              <div>
                <span>
                  {a} <b>{r[a]}</b>
                </span>
                <span>
                  <b>{r[b]}</b> {b}
                </span>
              </div>
              <div
                className="k-rivalry-track"
                aria-label={`${a}: ${r[a]}, ${b}: ${r[b]}`}
              >
                <i style={{ width: `${total ? (r[a] / total) * 100 : 50}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {limit < data.length && (
        <button
          className="k-text-action"
          onClick={() => setLimit((n) => n + 6)}
        >
          მეტი წყვილი +
        </button>
      )}
    </section>
  );
}
