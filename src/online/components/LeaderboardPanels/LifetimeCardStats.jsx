import { useEffect, useState } from "react";
import { api } from "../../lib/api";
const FIELDS = [
  ["K♥", "გულის მეფე", "kingsOfHearts"],
  ["Q", "დამები", "queens"],
  ["J", "ვალეტები", "jacks"],
  ["♥", "გულები", "hearts"],
];
export default function LifetimeCardStats({ players }) {
  const [selected, setSelected] = useState("");
  const name = selected || players[0]?.name;
  const [result, setResult] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!name) return;
    let alive = true;
    setResult(null);
    setError(false);
    api
      .getLifetimeStats(name)
      .then((r) => {
        if (alive) setResult(r);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [name, attempt]);
  if (!players.length) return null;
  return (
    <section className="k-analysis-panel">
      <header>
        <div>
          <span className="k-eyebrow">04 / PLAYER PROFILE</span>
          <h2>საერთო სტატისტიკა</h2>
        </div>
        <select
          aria-label="მოთამაშის საერთო სტატისტიკა"
          value={name}
          onChange={(e) => setSelected(e.target.value)}
        >
          {players.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </header>
      {error ? (
        <div className="k-data-empty">
          მონაცემები ვერ ჩაიტვირთა.
          <button
            className="k-text-action"
            onClick={() => setAttempt((n) => n + 1)}
          >
            სცადე თავიდან
          </button>
        </div>
      ) : !result ? (
        <p className="k-data-empty" role="status">
          იტვირთება…
        </p>
      ) : (
        <>
          <div className="k-lifetime-summary">
            <div>
              <strong>{result.gamesPlayed ?? 0}</strong>
              <small>თამაში</small>
            </div>
            <div>
              <strong>{result.wins ?? 0}</strong>
              <small>მოგება</small>
            </div>
            <div>
              <strong>{result.totalScore ?? 0}</strong>
              <small>ჯამური ქულა</small>
            </div>
          </div>
          <div className="k-lifetime-cards">
            {FIELDS.map(([symbol, label, key]) => (
              <div key={key}>
                <span>{symbol}</span>
                <strong>{result[key] ?? 0}</strong>
                <small>{label}</small>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
