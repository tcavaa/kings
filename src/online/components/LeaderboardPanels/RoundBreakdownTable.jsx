import { getGameType } from "../../constants/gameTypes";
const SUITS = { H: "♥", D: "♦", S: "♠", C: "♣" };
export default function RoundBreakdownTable({ details, playerList }) {
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
