import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api } from "../../lib/api";
import { buildTrioStats, recentForm } from "../../lib/playerStats";
import { currentSeasonOf, gamesSince } from "../../lib/seasons";
import { winnerNames } from "../../../../server/games/results.js";
import AvatarImg from "../AvatarImg";
import FormGuide from "./FormGuide";

const PAGE = 12;
const FORM_GAMES = 5;
const fmt = (d) =>
  new Date(d).toLocaleDateString("ka-GE", { day: "2-digit", month: "short", year: "numeric" });
const pct = (wins, games) => (games ? Math.round((wins / games) * 100) : 0);

/**
 * One trio: its three players by wins, each with their form in the last games
 * the three played together, and the last of those games.
 */
function TrioCard({ trio, avatarFor, onPlayerSelect, onSelectGame }) {
  const total = trio.games.length;
  const rows = trio.names
    .map((name) => ({ name, wins: trio.wins[name] }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  const top = rows[0].wins;
  const last = trio.games[0];
  const lastWinners = winnerNames(last);
  const lastOurs = lastWinners.filter((n) => trio.names.includes(n));
  return (
    <article className="k-trio">
      <header>
        <strong>{total}</strong>
        <span>თამაში ერთად</span>
      </header>
      <ol>
        {rows.map((r) => (
          <li key={r.name} className={top > 0 && r.wins === top ? "is-leader" : undefined}>
            <button
              className="k-player-link"
              onClick={() => onPlayerSelect?.(r.name)}
              aria-label={`${r.name} — პროფილი`}
            >
              <AvatarImg avatar={avatarFor(r.name)} name={r.name} size={32} />
              <strong>{r.name}</strong>
            </button>
            <span className="k-wins-badge">{r.wins}</span>
            <small>{pct(r.wins, total)}%</small>
            <span className="k-trio-form">
              <FormGuide
                form={recentForm(trio.games, r.name, FORM_GAMES)}
                name={r.name}
                onSelectGame={onSelectGame}
                size="sm"
              />
            </span>
          </li>
        ))}
        {trio.otherWins > 0 && (
          <li className="is-other">
            <span>სხვამ მოიგო</span>
            <span className="k-wins-badge">{trio.otherWins}</span>
            <small>{pct(trio.otherWins, total)}%</small>
          </li>
        )}
      </ol>
      <button className="k-trio-last" onClick={() => onSelectGame?.(last)}>
        <span>
          ბოლო · {fmt(last.playedAt)}
          <small>{last.type === "live" ? "LIVE" : "ONLINE"}</small>
        </span>
        <strong>
          {(lastOurs.length ? lastOurs : lastWinners).join(" & ") || "—"}
          {!lastOurs.length && lastWinners.length > 0 && <em> (სხვა)</em>}
        </strong>
        <ArrowUpRight size={15} />
      </button>
    </article>
  );
}

/**
 * Every three players who played together: their games, each one's wins and
 * win rate in those games, and who took the last one. `state` ({ seasonOnly,
 * player, sort }) lives in the leaderboard, so it survives opening a game.
 */
export default function TriosPanel({ games, players, state, onState, onPlayerSelect, onSelectGame }) {
  const { seasonOnly, player, sort } = state;
  const set = (patch) => onState({ ...state, ...patch });
  const [seasons, setSeasons] = useState(null);
  const [seasonError, setSeasonError] = useState(false);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    if (!seasonOnly || seasons) return;
    let alive = true;
    api.listSeasons().then(
      (s) => alive && setSeasons(Array.isArray(s) ? s : []),
      () => alive && setSeasonError(true),
    );
    return () => {
      alive = false;
    };
  }, [seasonOnly, seasons]);
  useEffect(() => setShown(PAGE), [seasonOnly, player, sort, games]);

  const { season, start } = currentSeasonOf(seasons);
  const scoped = useMemo(
    () => (seasonOnly ? gamesSince(games, start) : games),
    [games, seasonOnly, start],
  );
  const trios = useMemo(() => {
    const all = buildTrioStats(scoped).filter((t) => !player || t.names.includes(player));
    const lastAt = (t) => new Date(t.games[0].playedAt).getTime();
    return all.sort((a, b) =>
      sort === "recent"
        ? lastAt(b) - lastAt(a)
        : b.games.length - a.games.length || lastAt(b) - lastAt(a),
    );
  }, [scoped, player, sort]);
  const names = useMemo(() => players.map((p) => p.name).sort((a, b) => a.localeCompare(b)), [players]);
  const avatarFor = (name) => players.find((p) => p.name === name)?.avatar || null;
  const seasonPending = seasonOnly && !seasons && !seasonError;

  return (
    <section className="k-trios">
      <header className="k-trios-head">
        <div>
          <span className="k-eyebrow">02 / TRIOS</span>
          <h2>სამეულები</h2>
        </div>
        <div className="k-trio-tools">
          <button
            type="button"
            className="k-trio-toggle"
            role="switch"
            aria-checked={seasonOnly}
            onClick={() => set({ seasonOnly: !seasonOnly })}
          >
            <i aria-hidden="true" />
            მიმდინარე სეზონი
          </button>
          <select aria-label="მოთამაშე" value={player} onChange={(e) => set({ player: e.target.value })}>
            <option value="">ყველა მოთამაშე</option>
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <select aria-label="დალაგება" value={sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="games">თამაშებით</option>
            <option value="recent">ბოლო თამაშით</option>
          </select>
        </div>
      </header>
      {seasonOnly && season?.name && !seasonPending && (
        <p className="k-trio-scope">
          {season.name} · {start ? `${fmt(start)}-დან` : ""} · {scoped.length} თამაში
        </p>
      )}
      {seasonOnly && seasonError ? (
        <p className="k-data-empty">სეზონის ჩატვირთვა ვერ მოხერხდა.</p>
      ) : seasonPending ? (
        <p className="k-data-empty" role="status">
          სეზონი იტვირთება…
        </p>
      ) : !trios.length ? (
        <p className="k-data-empty">
          {seasonOnly ? "ამ სეზონში სამეულის თამაში ჯერ არ არის." : "სამეულის თამაში ჯერ არ არის."}
        </p>
      ) : (
        <>
          <div className="k-trio-grid">
            {trios.slice(0, shown).map((t) => (
              <TrioCard
                key={t.names.join("|")}
                trio={t}
                avatarFor={avatarFor}
                onPlayerSelect={onPlayerSelect}
                onSelectGame={onSelectGame}
              />
            ))}
          </div>
          {trios.length > shown && (
            <button className="k-text-action" onClick={() => setShown((n) => n + PAGE)}>
              მეტის ჩვენება ({trios.length - shown})
            </button>
          )}
        </>
      )}
    </section>
  );
}
