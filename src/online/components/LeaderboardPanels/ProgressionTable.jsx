export default function ProgressionTable({ rows, players }) {
  return (
    <div className="k-table-scroll">
      <table className="k-data-table">
        <thead>
          <tr>
            <th>რაუნდი</th>
            {players.map((p) => (
              <th key={p.seat}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th>{String(r.round).padStart(2, "0")}</th>
              {players.map((p) => (
                <td
                  key={p.seat}
                  className={r[p.seat] < 0 ? "is-negative" : "is-positive"}
                >
                  {r[p.seat] > 0 ? "+" : ""}
                  {r[p.seat] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
