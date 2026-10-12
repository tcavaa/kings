import { ArrowUpRight } from "lucide-react-online";
/** Small ლიგა/კლასიკური pill shown on each game row (and the detail header). */
export function GameModeTag({ isChampionship, className = "" }) {
  const championship = isChampionship !== false; // records without the flag are legacy championship games
  return (
    <span className={`k-mode-tag ${className}`}>
      {championship ? "RANKED / ლიგა" : "CLASSIC / კლასიკური"}
    </span>
  );
}

/** Paginated match history. Detailed achievements load when a match is opened. */
export default function PastGamesList({ loading, games, onSelect }) {
  if (loading)
    return (
      <p className="k-empty" role="status">
        ისტორია იტვირთება…
      </p>
    );
  if (!games.length)
    return <p className="k-empty">პირველი თამაში აქ გამოჩნდება.</p>;
  return (
    <div className="k-match-history">
      {games.map((g) => (
        <button key={g.id} onClick={() => onSelect(g)}>
          <span className="k-history-date">
            <strong>
              {new Date(g.playedAt).toLocaleDateString("ka-GE", {
                day: "2-digit",
                month: "short",
              })}
            </strong>
            <small>
              {new Date(g.playedAt).toLocaleTimeString("ka-GE", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          </span>
          <span className="k-history-winner">
            <small>
              {g.winners?.length > 1 ? "გამარჯვებულები" : "გამარჯვებული"}
            </small>
            <strong>
              {g.winners?.length
                ? g.winners.map((w) => w.name).join(" & ")
                : g.winner?.name || "—"}
            </strong>
            <span>{g.players?.map((p) => p.name).join(" / ")}</span>
          </span>
          <span className="k-history-mode">
            {g.isChampionship === false ? "CLASSIC" : "RANKED"}
            <small>{g.players?.length} მოთამაშე</small>
          </span>
          <ArrowUpRight size={21} />
        </button>
      ))}
    </div>
  );
}
