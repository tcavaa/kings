import { useGame } from "../context/GameContext";
import { getGameType } from "../constants/gameTypes";
const value = (n) => (n > 0 ? `+${n}` : (n ?? "—"));
export default function ScoreTable() {
  const { roundScores, cumulativeScores, players } = useGame();
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  return (
    <section className="k-score-content">
      <div className="k-score-totals">
        {sorted.map((p) => (
          <div key={p.seat}>
            <span title={p.name}>{p.name}</span>
            <strong>{value(cumulativeScores[p.seat] ?? 0)}</strong>
            <small>ჯამური ქულა</small>
          </div>
        ))}
      </div>
      {!roundScores.length ? (
        <p className="k-data-empty">პირველი რაუნდის შედეგები აქ გამოჩნდება.</p>
      ) : (
        <div className="k-table-scroll">
          <table className="k-data-table">
            <thead>
              <tr>
                <th>რაუნდი</th>
                {sorted.map((p) => (
                  <th key={p.seat} title={p.name}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roundScores.map((r, i) => (
                <tr key={i}>
                  <th>
                    <span>{String(r.round).padStart(2, "0")}</span>
                    <small>{getGameType(r.gameType)?.name || r.gameType}</small>
                  </th>
                  {sorted.map((p) => (
                    <td
                      key={p.seat}
                      className={
                        r.scores?.[p.seat] < 0 ? "is-negative" : "is-positive"
                      }
                    >
                      {value(r.scores?.[p.seat])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
