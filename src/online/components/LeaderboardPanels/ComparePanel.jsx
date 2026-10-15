import { useMemo, useState } from "react";
import { Check, Trophy } from "lucide-react";
import AvatarImg from "../AvatarImg";
import FormGuide from "./FormGuide";
import PastGamesList from "./PastGamesList";
import { GAME_TYPES } from "../../constants/gameTypes";
import { comparePlayers, recentForm } from "../../lib/playerStats";
import { signed } from "../../utils/format";

const MAX = 4;
const SCOPES = [
  ["shared", "საერთო თამაშები"],
  ["all", "ყველა თამაში"],
];

/**
 * Two to four players side by side, over the leaderboard's game-type filter
 * (ყველა = live and online together): their record against each other in
 * the games they all played, or each one's whole record.
 */
export default function ComparePanel({
  games,
  players,
  onSelectGame,
  state,
  onState,
}) {
  const names = useMemo(() => players.map((p) => p.name), [players]);
  // The leaderboard keeps the choice, so it survives opening a game.
  const [own, setOwn] = useState({ picked: null, scope: "shared" });
  const cur = state || own;
  const setCur = onState || setOwn;
  const picked = cur.picked ?? names.slice(0, 2);
  const scope = cur.scope;
  const setScope = (s) => setCur({ ...cur, picked, scope: s });
  const setPicked = (fn) => setCur({ ...cur, picked: fn(picked) });
  // A filter change can drop someone; keep only names still ranked.
  const selected = useMemo(
    () => picked.filter((n) => names.includes(n)),
    [picked, names],
  );
  const cmp = useMemo(
    () =>
      selected.length >= 2 ? comparePlayers(games, selected, { scope }) : null,
    [games, selected, scope],
  );
  const avatarOf = (name) => players.find((p) => p.name === name)?.avatar;
  const toggle = (name) =>
    setPicked((prev) => {
      const cur = prev.filter((n) => names.includes(n));
      if (cur.includes(name)) return cur.filter((n) => n !== name);
      return cur.length >= MAX ? cur : [...cur, name];
    });
  const formPool = scope === "all" ? games : cmp?.shared || [];

  return (
    <div className="k-compare">
      <section className="k-analysis-panel">
        <header>
          <div>
            <span className="k-eyebrow">
              COMPARE / {selected.length} OF {MAX}
            </span>
            <h2>მოთამაშეების შედარება</h2>
          </div>
          <div className="k-segmented" role="group" aria-label="რა თამაშები">
            {SCOPES.map(([id, label]) => (
              <button
                key={id}
                aria-pressed={scope === id}
                onClick={() => setScope(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        <div className="k-compare-chips">
          {names.map((name) => {
            const on = selected.includes(name);
            return (
              <button
                key={name}
                aria-pressed={on}
                disabled={!on && selected.length >= MAX}
                onClick={() => toggle(name)}
              >
                <AvatarImg avatar={avatarOf(name)} size={24} />
                <span>{name}</span>
                {on && <Check size={14} />}
              </button>
            );
          })}
        </div>
        {!cmp && (
          <p className="k-data-empty">აირჩიე მინიმუმ ორი მოთამაშე.</p>
        )}
      </section>

      {cmp && cmp.shared.length === 0 && scope === "shared" && (
        <section className="k-analysis-panel">
          <p className="k-data-empty">
            {selected.join(", ")} ერთ მაგიდასთან ჯერ არ უთამაშიათ. სცადე „ყველა
            თამაში“.
          </p>
        </section>
      )}

      {cmp && (cmp.shared.length > 0 || scope === "all") && (
        <>
          {cmp.shared.length > 0 && (
            <section className="k-analysis-panel">
              <header>
                <div>
                  <span className="k-eyebrow">01 / HEAD TO HEAD</span>
                  <h2>პირისპირ</h2>
                </div>
                <p className="k-compare-split">
                  <b>{cmp.shared.length}</b> საერთო თამაში
                  <span>
                    {cmp.live} ლაივი · {cmp.online} ონლაინ
                  </span>
                </p>
              </header>
              {selected.length === 2 ? (
                <PairScore
                  cmp={cmp}
                  a={selected[0]}
                  b={selected[1]}
                  avatarOf={avatarOf}
                />
              ) : (
                <AheadMatrix cmp={cmp} names={selected} />
              )}
            </section>
          )}

          <section className="k-analysis-panel">
            <header>
              <div>
                <span className="k-eyebrow">02 / RECORD</span>
                <h2>
                  {scope === "shared" ? "საერთო თამაშებში" : "სრული ისტორია"}
                </h2>
              </div>
            </header>
            <div className="k-table-scroll">
              <table className="k-data-table k-compare-table">
                <thead>
                  <tr>
                    <th>მოთამაშე</th>
                    <th>ფორმა</th>
                    <th>თამაში</th>
                    <th>
                      მოგება<small>მ.შ. გაყოფილი</small>
                    </th>
                    <th>მოგ. %</th>
                    <th>საშ. ქულა</th>
                    <th>საშ. ადგილი</th>
                    <th>საუკეთესო</th>
                    <th>
                      ლაივი<small>მოგება / თამაში</small>
                    </th>
                    <th>
                      ონლაინ<small>მოგება / თამაში</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.rows.map((r) => {
                    const lead = leaderOf(cmp.rows, r);
                    return (
                      <tr key={r.name}>
                        <th>
                          <div className="k-player-cell">
                            <AvatarImg avatar={avatarOf(r.name)} size={28} />
                            <span>{r.name}</span>
                            {lead.wins && (
                              <Trophy size={13} className="k-compare-crown" />
                            )}
                          </div>
                        </th>
                        <td>
                          <FormGuide
                            form={recentForm(formPool, r.name, 5)}
                            name={r.name}
                            onSelectGame={onSelectGame}
                            size="sm"
                          />
                        </td>
                        <td>{r.games}</td>
                        <td className={lead.wins ? "is-positive" : ""}>
                          <b>{r.wins}</b>
                          {r.draws > 0 && (
                            <span className="k-muted"> ({r.draws})</span>
                          )}
                        </td>
                        <td className={lead.winPct ? "is-positive" : ""}>
                          {r.winPct ?? "—"}
                          {r.winPct != null && "%"}
                        </td>
                        <td className={lead.avg ? "is-positive" : ""}>
                          {r.avg == null ? "—" : signed(r.avg)}
                        </td>
                        <td className={lead.avgPlace ? "is-positive" : ""}>
                          {r.avgPlace ?? "—"}
                        </td>
                        <td>{r.games ? signed(r.best) : "—"}</td>
                        <td>
                          {r.liveWins} / {r.liveGames}
                        </td>
                        <td>
                          {r.onlineWins} / {r.onlineGames}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <TypeTable cmp={cmp} names={selected} />

          {cmp.shared.length > 0 && (
            <section className="k-analysis-panel k-compare-games">
              <header>
                <div>
                  <span className="k-eyebrow">04 / TOGETHER</span>
                  <h2>ბოლო საერთო თამაშები</h2>
                </div>
              </header>
              <PastGamesList
                games={cmp.shared.slice(0, 5)}
                onSelect={onSelectGame}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Which of `row`'s numbers are the best among `rows` (ties all lead). */
function leaderOf(rows, row) {
  const played = rows.filter((r) => r.games > 0);
  if (!row.games || played.length < 2) return {};
  const top = (key, low = false) => {
    const vals = played.map((r) => r[key]);
    const best = low ? Math.min(...vals) : Math.max(...vals);
    return row[key] === best && vals.some((v) => v !== best);
  };
  return {
    wins: top("wins"),
    winPct: top("winPct"),
    avg: top("avg"),
    avgPlace: top("avgPlace", true),
  };
}

function PairScore({ cmp, a, b, avatarOf }) {
  const rowA = cmp.rows.find((r) => r.name === a);
  const rowB = cmp.rows.find((r) => r.name === b);
  // Wins inside the shared games, whatever the record table's scope.
  const winsIn = (name) =>
    cmp.shared.filter((g) =>
      (g.winners || []).some((w) => w?.name === name),
    ).length;
  const aWins = winsIn(a);
  const bWins = winsIn(b);
  const both = cmp.shared.filter((g) => {
    const w = (g.winners || []).map((x) => x?.name);
    return w.includes(a) && w.includes(b);
  }).length;
  const others = cmp.shared.length - aWins - bWins + both;
  const aAhead = cmp.ahead[a][b];
  const bAhead = cmp.ahead[b][a];
  const level = cmp.shared.length - aAhead - bAhead;
  return (
    <div className="k-compare-pair">
      <div>
        <AvatarImg avatar={avatarOf(a)} size={56} />
        <span>{a}</span>
      </div>
      <strong>
        <b className={aWins > bWins ? "is-positive" : ""}>{aWins}</b>
        <i>–</i>
        <b className={bWins > aWins ? "is-positive" : ""}>{bWins}</b>
        <small>მოგება</small>
      </strong>
      <div>
        <AvatarImg avatar={avatarOf(b)} size={56} />
        <span>{b}</span>
      </div>
      <div className="k-compare-ahead">
        <span>მეტი ქულით დაასრულა</span>
        <div className="k-rivalry-track" aria-hidden="true">
          <i
            style={{
              width: `${aAhead + bAhead ? (aAhead / (aAhead + bAhead)) * 100 : 50}%`,
            }}
          />
        </div>
        <p>
          <b>{aAhead}×</b> {a} · {b} <b>{bAhead}×</b>
        </p>
        <small>
          {others > 0 && `${others} თამაში სხვამ მოიგო`}
          {others > 0 && (level > 0 || both > 0) && " · "}
          {both > 0 && `${both} ერთად მოიგეს`}
          {both > 0 && level > 0 && " · "}
          {level > 0 && `${level} თანაბარი ქულით`}
          {rowA && rowB && rowA.avg != null && rowB.avg != null && (
            <>
              {" "}
              · საშ. {signed(rowA.avg)} / {signed(rowB.avg)}
            </>
          )}
        </small>
      </div>
    </div>
  );
}

/** 3–4 players: cell = how often the row's player outscored the column's. */
function AheadMatrix({ cmp, names }) {
  return (
    <div className="k-table-scroll">
      <table className="k-data-table k-compare-matrix">
        <thead>
          <tr>
            <th>
              აჯობა ↓<small>ვის →</small>
            </th>
            {names.map((n) => (
              <th key={n}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((row) => (
            <tr key={row}>
              <th>{row}</th>
              {names.map((col) =>
                row === col ? (
                  <td key={col} className="k-muted">
                    —
                  </td>
                ) : (
                  <td
                    key={col}
                    className={
                      cmp.ahead[row][col] > cmp.ahead[col][row]
                        ? "is-positive"
                        : ""
                    }
                  >
                    {cmp.ahead[row][col]}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Average round score per game type, best of the selected highlighted. */
function TypeTable({ cmp, names }) {
  const rows = GAME_TYPES.filter((t) =>
    names.some((n) => cmp.byType[n]?.[t.code]),
  );
  if (!rows.length) return null;
  return (
    <section className="k-analysis-panel">
      <header>
        <div>
          <span className="k-eyebrow">03 / BY GAME TYPE</span>
          <h2>საშუალო ქულა თამაშის ტიპით</h2>
        </div>
      </header>
      <div className="k-table-scroll">
        <table className="k-data-table k-compare-matrix">
          <thead>
            <tr>
              <th>ტიპი</th>
              {names.map((n) => (
                <th key={n}>{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const vals = names.map((n) => cmp.byType[n]?.[t.code]?.avg);
              const present = vals.filter((v) => v != null);
              const best = Math.max(...present);
              return (
                <tr key={t.code}>
                  <th>
                    <span className="k-type-name">
                      <i style={{ background: t.color }} />
                      {t.name}
                    </span>
                  </th>
                  {vals.map((v, i) => (
                    <td
                      key={names[i]}
                      className={
                        v === best && present.some((x) => x !== best)
                          ? "is-positive"
                          : ""
                      }
                    >
                      {v == null ? "—" : signed(v)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
