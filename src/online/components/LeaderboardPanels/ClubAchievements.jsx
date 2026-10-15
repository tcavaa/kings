import { useMemo, useState } from "react";
import AvatarImg from "../AvatarImg";
import { Emblem } from "../AchievementBadges";
import { ACHIEVEMENT_DEFS } from "../../utils/achievements";

const TOTAL = Object.keys(ACHIEVEMENT_DEFS).length;
const SORTS = [
  ["order", "რიგით"],
  ["rarest", "იშვიათი ჯერ"],
  ["common", "გავრცელებული ჯერ"],
];
const pct = (share) => `${Math.round(share * 100)}%`;
const dateOf = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("ka-GE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * The whole club's collection: who holds each badge, how rare it is, who
 * earns it most often, who got it first and most recently, and the
 * collectors' table. `stats` is clubAchievementStats(games, names).
 */
export default function ClubAchievements({ stats, players }) {
  const [sort, setSort] = useState("order");
  const avatarOf = (name) =>
    players.find((p) => p.name === name)?.avatar || null;
  const badges = useMemo(() => {
    const list = [...stats.badges];
    if (sort === "rarest")
      list.sort(
        (a, b) =>
          (a.holders.length || Infinity) - (b.holders.length || Infinity),
      );
    if (sort === "common")
      list.sort((a, b) => b.holders.length - a.holders.length);
    return list;
  }, [stats, sort]);
  const top = stats.collectors[0];
  const rarest = stats.rarest && ACHIEVEMENT_DEFS[stats.rarest.code];
  const latest = stats.latest && ACHIEVEMENT_DEFS[stats.latest.code];
  const ranked = players.length;

  return (
    <>
      <div className="k-club-facts">
        <div>
          <span>ყველაზე დიდი კოლექცია</span>
          {top ? (
            <>
              <strong>
                {top.unique}
                <small> / {TOTAL}</small>
              </strong>
              <div className="k-club-fact-note">
                <AvatarImg avatar={avatarOf(top.name)} name={top.name} size={20} />
                {top.name}
              </div>
            </>
          ) : (
            <strong>—</strong>
          )}
        </div>
        <div>
          <span>ყველაზე იშვიათი</span>
          {rarest ? (
            <>
              <strong>{pct(stats.rarest.share)}</strong>
              <div className="k-club-fact-note">
                {rarest.label} ·{" "}
                {stats.rarest.holders.map((h) => h.name).join(", ")}
              </div>
            </>
          ) : (
            <strong>—</strong>
          )}
        </div>
        <div>
          <span>ბოლოს მოპოვებული</span>
          {latest ? (
            <>
              <strong className="k-club-fact-name">{latest.label}</strong>
              <div className="k-club-fact-note">
                {stats.latest.name} · {dateOf(stats.latest.at)}
              </div>
            </>
          ) : (
            <strong>—</strong>
          )}
        </div>
        <div>
          <span>სულ მოპოვებული</span>
          <strong>{stats.total}</strong>
          <div className="k-club-fact-note">
            {stats.badges.filter((b) => b.holders.length).length} / {TOTAL}{" "}
            მიღწევა გახსნილია
          </div>
        </div>
      </div>

      <div className="k-club-toolbar">
        <span className="k-eyebrow">ALL {TOTAL} / BY THE CLUB</span>
        <select
          aria-label="მიღწევების დალაგება"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {SORTS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <ol className="k-club-badges">
        {badges.map((b) => {
          const def = ACHIEVEMENT_DEFS[b.code];
          return (
            <li key={b.code} className={b.holders.length ? "" : "is-locked"}>
              <div className="k-achievement-art">
                <Emblem code={b.code} def={def} />
              </div>
              <div className="k-club-badge-main">
                <header>
                  <strong>{def.label}</strong>
                  <span className={`k-rarity is-${b.rarity.id}`}>
                    {b.rarity.label}
                  </span>
                </header>
                <p>{def.desc}</p>
                <div className="k-club-share">
                  <div className="k-rivalry-track" aria-hidden="true">
                    <i style={{ width: pct(b.share) }} />
                  </div>
                  <small>
                    {pct(b.share)} · {b.holders.length} / {ranked} მოთამაშე
                    {b.repeatable && b.total > 0 && ` · სულ ×${b.total}`}
                  </small>
                </div>
              </div>
              <dl className="k-club-badge-facts">
                {b.repeatable ? (
                  <>
                    <Fact label="ყველაზე ხშირად" holder={b.most}>
                      {b.most && `×${b.most.count}`}
                    </Fact>
                    {b.perGame ? (
                      <Fact
                        label={
                          b.code === "PERFECT_PLUS"
                            ? "უმაღლესი % პლიუს რაუნდებში"
                            : "უმაღლესი % თამაშებში"
                        }
                        holder={b.bestRate}
                      >
                        {b.bestRate && `${(b.bestRate.rate * 100).toFixed(1)}%`}
                      </Fact>
                    ) : (
                      <Fact label="პირველი" holder={b.first}>
                        {b.first && dateOf(b.first.first)}
                      </Fact>
                    )}
                  </>
                ) : (
                  <>
                    <Fact label="პირველი" holder={b.first}>
                      {b.first && dateOf(b.first.first)}
                    </Fact>
                    <Fact label="ბოლოს" holder={b.latest}>
                      {b.latest && dateOf(b.latest.last)}
                    </Fact>
                  </>
                )}
              </dl>
              <div
                className="k-club-holders"
                aria-label={b.holders.map((h) => h.name).join(", ")}
              >
                {b.holders.slice(0, 5).map((h) => (
                  <span key={h.name} title={`${h.name}${h.count > 1 ? ` ×${h.count}` : ""}`}>
                    <AvatarImg avatar={avatarOf(h.name)} name={h.name} size={26} />
                  </span>
                ))}
                {b.holders.length > 5 && <em>+{b.holders.length - 5}</em>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="k-club-collectors">
        <header>
          <span className="k-eyebrow">THE COLLECTORS</span>
          <h3>კოლექციონერები</h3>
        </header>
        <ol>
          {stats.collectors.map((c, i) => (
            <li key={c.name}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div className="k-player-cell">
                <AvatarImg avatar={avatarOf(c.name)} name={c.name} size={28} />
                <span>{c.name}</span>
              </div>
              <div className="k-rivalry-track" aria-hidden="true">
                <i style={{ width: `${(c.unique / TOTAL) * 100}%` }} />
              </div>
              <strong>
                {c.unique}
                <small>/{TOTAL}</small>
              </strong>
              <small>×{c.total}</small>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

function Fact({ label, holder, children }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {holder ? (
          <>
            <b>{holder.name}</b>
            <span>{children}</span>
          </>
        ) : (
          <span className="k-muted">—</span>
        )}
      </dd>
    </div>
  );
}
