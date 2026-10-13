import { useMemo, useState } from "react";
import AvatarImg from "../AvatarImg";
import { isWinnerName, isRemovedPlayer } from "../../lib/leaderboard";

/**
 * "You vs Ramaz" panel: select a player from the dropdown and see your record
 * against everyone else, computed from the games array.
 */
function buildH2H(games) {
  // pair-key (sorted player names) -> { a, b, aWins, bWins, aTotal, bTotal,
  //                                     aBest, bBest, gamesShared }
  const map = new Map();
  for (const g of games) {
    const players = (g.players || []).filter((p) => !isRemovedPlayer(p));
    if (players.length < 2) continue;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const A = players[i],
          B = players[j];
        const [first, second] = [A.name, B.name].sort();
        const key = `${first}${second}`;
        const Afirst = first === A.name;
        const row = map.get(key) || {
          a: first,
          b: second,
          aWins: 0,
          bWins: 0,
          aTotal: 0,
          bTotal: 0,
          aBest: -Infinity,
          bBest: -Infinity,
          gamesShared: 0,
        };
        row.gamesShared += 1;
        const aScore = Afirst ? (A.score ?? 0) : (B.score ?? 0);
        const bScore = Afirst ? (B.score ?? 0) : (A.score ?? 0);
        row.aTotal += aScore;
        row.bTotal += bScore;
        if (aScore > row.aBest) row.aBest = aScore;
        if (bScore > row.bBest) row.bBest = bScore;
        // Tie-aware: a shared top score means both names take a win.
        if (isWinnerName(g, row.a)) row.aWins += 1;
        if (isWinnerName(g, row.b)) row.bWins += 1;
        map.set(key, row);
      }
    }
  }
  return Array.from(map.values());
}

export default function HeadToHeadPanel({ games, players }) {
  const [me, setMe] = useState(players[0]?.name || "");
  const h2h = useMemo(() => buildH2H(games), [games]);

  // Filter rows to those involving "me" and orient them so "me" is on the left.
  const mine = useMemo(() => {
    if (!me) return [];
    return h2h
      .filter((r) => r.a === me || r.b === me)
      .map((r) =>
        r.a === me
          ? {
              other: r.b,
              avatarOf: r.b,
              wins: r.aWins,
              losses: r.bWins,
              total: r.aTotal,
              best: r.aBest,
              games: r.gamesShared,
            }
          : {
              other: r.a,
              avatarOf: r.a,
              wins: r.bWins,
              losses: r.aWins,
              total: r.bTotal,
              best: r.bBest,
              games: r.gamesShared,
            },
      )
      .sort((x, y) => y.games - x.games);
  }, [h2h, me]);

  // Find avatars by name (best-effort lookup).
  const avatarFor = (name) => {
    for (const g of games) {
      const p = (g.players || []).find((pp) => pp.name === name);
      if (p?.avatar) return p.avatar;
    }
    return null;
  };

  if (!players.length) return null;

  return (
    <section className="k-analysis-panel">
      <header>
        <div>
          <span className="k-eyebrow">01 / HEAD TO HEAD</span>
          <h2>პირისპირ</h2>
        </div>
        <select
          aria-label="მოთამაშე პირისპირ შედარებისთვის"
          value={me}
          onChange={(e) => setMe(e.target.value)}
        >
          {players.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </header>
      {!mine.length ? (
        <p className="k-data-empty">საერთო თამაშები ჯერ არ არის.</p>
      ) : (
        <div className="k-table-scroll">
          <table className="k-data-table">
            <thead>
              <tr>
                <th>მეტოქე</th>
                <th>თამაშები</th>
                <th>
                  მოგებები<small>შენ / მეტოქე</small>
                </th>
                <th>ჯამი</th>
                <th>საუკეთესო</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.other}>
                  <th>
                    <div className="k-player-cell">
                      <AvatarImg avatar={avatarFor(r.avatarOf)} size={28} />
                      <span>{r.other}</span>
                    </div>
                  </th>
                  <td>{r.games}</td>
                  <td>
                    <b>{r.wins}</b>
                    <span className="k-muted"> / {r.losses}</span>
                  </td>
                  <td>
                    {r.total > 0 ? "+" : ""}
                    {r.total}
                  </td>
                  <td>{Number.isFinite(r.best) ? r.best : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
