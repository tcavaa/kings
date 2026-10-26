import AvatarImg from "../AvatarImg";
import FormGuide from "./FormGuide";
import { recentForm } from "../../lib/playerStats";
import { winRate } from "../../utils/format";
export default function PlayersTable({
  aggregated,
  games = [],
  onPlayerSelect,
  onSelectGame,
}) {
  return (
    <div className="k-rank-table-wrap">
      <table className="k-rank-table">
        <thead>
          <tr>
            <th>#</th>
            <th>მოთამაშე</th>
            <th>ფორმა</th>
            <th>თამაში</th>
            <th>მოგება</th>
            <th>მოგ. %</th>
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
                  <AvatarImg avatar={p.avatar} name={p.name} size={36} />
                  <strong>{p.name}</strong>
                </button>
              </td>
              <td className="k-form-cell">
                <FormGuide
                  form={recentForm(games, p.name, 5)}
                  name={p.name}
                  onSelectGame={onSelectGame}
                  size="sm"
                />
              </td>
              <td>{p.gamesPlayed}</td>
              <td>
                <span className="k-wins-badge">{p.wins}</span>
              </td>
              <td>{winRate(p)}%</td>
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
