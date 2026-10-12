import AvatarImg from "./AvatarImg";
import { isWinnerName } from "../../lib/leaderboard";
export default function PodiumView({ game, sortedPlayers }) {
  return (
    <section className="k-match-report">
      <header>
        <div>
          <span className="k-eyebrow">MATCH / COMPLETE</span>
          <h2>თამაში ციფრებში.</h2>
        </div>
        {game?.playedAt && (
          <time>{new Date(game.playedAt).toLocaleDateString("ka-GE")}</time>
        )}
      </header>
      <div className="k-report-standings">
        {sortedPlayers.map((p, i) => (
          <div
            key={p.seat}
            className={isWinnerName(game, p.name) ? "is-winner" : ""}
          >
            <span className="k-report-rank">
              {String(
                isWinnerName(game, p.name) ? 1 : i + 1,
              ).padStart(2, "0")}
            </span>
            <AvatarImg avatar={p.avatar} size={40} />
            <div>
              <strong>{p.name}</strong>
              <small>
                {isWinnerName(game, p.name) ? "გამარჯვებული" : "საბოლოო შედეგი"}
              </small>
            </div>
            <b>
              {p.score > 0 ? "+" : ""}
              {p.score ?? 0}
            </b>
          </div>
        ))}
      </div>
    </section>
  );
}
