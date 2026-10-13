import { useMemo } from "react";
import AvatarImg from "../AvatarImg";
import PlayerSelect, { usePlayerChoice } from "./PlayerSelect";

/**
 * "You vs Ramaz" panel: select a player from the dropdown and see their
 * record against everyone else. `pairs` is buildPairStats(games).
 */
export default function HeadToHeadPanel({ pairs, players }) {
  const names = useMemo(() => players.map((p) => p.name), [players]);
  const [me, setMe] = usePlayerChoice(names);

  // Filter rows to those involving "me" and orient them so "me" is on the left.
  const mine = useMemo(() => {
    if (!me) return [];
    return pairs
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
  }, [pairs, me]);

  const avatarFor = (name) =>
    players.find((p) => p.name === name)?.avatar || null;

  if (!players.length) return null;

  return (
    <section className="k-analysis-panel">
      <header>
        <div>
          <span className="k-eyebrow">01 / HEAD TO HEAD</span>
          <h2>პირისპირ</h2>
        </div>
        <PlayerSelect
          label="მოთამაშე პირისპირ შედარებისთვის"
          names={names}
          value={me}
          onChange={setMe}
        />
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
