import AvatarImg from "../AvatarImg";
export default function PlayersTable({ aggregated, onPlayerSelect }) {
  return (
    <div className="k-rank-table-wrap">
      <table className="k-rank-table">
        <thead>
          <tr>
            <th>#</th>
            <th>მოთამაშე</th>
            <th>თამაში</th>
            <th>მოგება</th>
            <th>ქულა</th>
          </tr>
        </thead>
        <tbody>
          {aggregated.map((p, i) => (
            <tr key={p.name}>
              <td>{String(p.rank || i + 1).padStart(2, "0")}</td>
              <td>
                <button
                  className="k-player-link"
                  onClick={() => onPlayerSelect(p.name)}
                  aria-label={`${p.name} — პროფილი`}
                >
                  <AvatarImg avatar={p.avatar} size={36} />
                  <strong>{p.name}</strong>
                </button>
              </td>
              <td>{p.gamesPlayed}</td>
              <td>
                <span className="k-wins-badge">{p.wins}</span>
              </td>
              <td className={p.totalScore < 0 ? "k-negative" : ""}>
                {p.totalScore > 0 ? "+" : ""}
                {p.totalScore}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
