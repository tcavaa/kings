import { useMemo, useState } from "react";

/** Win records of every pair, the pairs who met most often first. */
export default function RivalryGraph({ pairs }) {
  const data = useMemo(
    () => [...pairs].sort((x, y) => y.gamesShared - x.gamesShared),
    [pairs],
  );
  const [limit, setLimit] = useState(6);
  return (
    <section className="k-analysis-panel">
      <header>
        <div>
          <span className="k-eyebrow">02 / RIVALRIES</span>
          <h2>მეტოქეობა</h2>
        </div>
        <span className="k-muted">{data.length} წყვილი</span>
      </header>
      <div className="k-rivalries">
        {data.slice(0, limit).map((r) => {
          const total = r.aWins + r.bWins;
          return (
            <div key={`${r.a}|${r.b}`}>
              <div>
                <span>
                  {r.a} <b>{r.aWins}</b>
                </span>
                <span>
                  <b>{r.bWins}</b> {r.b}
                </span>
              </div>
              <div
                className="k-rivalry-track"
                aria-label={`${r.a}: ${r.aWins}, ${r.b}: ${r.bWins}`}
              >
                <i style={{ width: `${total ? (r.aWins / total) * 100 : 50}%` }} />
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
