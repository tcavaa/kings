import { getGameType } from "../../constants/gameTypes";
import { SUIT_SYMBOLS as SUITS } from "../../constants/suits";
/**
 * One row per round: type, trump and each player's score. `showLeader` adds
 * the round's leader (the results screen shows it). Rows may be full round
 * details or bare round scores; missing fields show as "—".
 */
export default function RoundBreakdownTable({
  details,
  playerList,
  showLeader = false,
}) {
  if (!details.length)
    return (
      <p className="k-data-empty">
        ამ თამაშის რაუნდების დეტალები არ არის შენახული.
      </p>
    );
  return (
    <section className="k-analysis-panel">
      <header>
        <div>
          <span className="k-eyebrow">ROUND / BY ROUND</span>
          <h2>ყოველი რაუნდის შედეგი</h2>
        </div>
      </header>
      <div className="k-table-scroll">
        <table className="k-data-table">
          <thead>
            <tr>
              <th>რაუნდი / ტიპი</th>
              {showLeader && <th>წამყვანი</th>}
              <th>კოზირი</th>
              {playerList.map((p) => (
                <th key={p.seat}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {details.map((d, i) => (
              <tr key={i}>
                <th>
                  {String(d.round).padStart(2, "0")}
                  <small>{getGameType(d.gameType)?.name || d.gameType}</small>
                </th>
                {showLeader && (
                  <td>
                    {playerList.find((p) => p.seat === d.leaderSeat)?.name ??
                      "—"}
                  </td>
                )}
                <td>{SUITS[d.trumpSuit] || "—"}</td>
                {playerList.map((p) => {
                  const v = d.scores?.[p.seat] ?? 0;
                  return (
                    <td
                      key={p.seat}
                      className={v < 0 ? "is-negative" : "is-positive"}
                    >
                      {v > 0 ? "+" : ""}
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
