import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const RESULT_LABELS = {
  W: "მოგება",
  D: "გაყოფილი მოგება",
  L: "წაგება",
};

const dateOf = (iso) =>
  new Date(iso).toLocaleDateString("ka-GE", { day: "2-digit", month: "short" });

/**
 * Flashscore-style form: one W / D / L box per game, newest on the left.
 * Hovering (or a first tap) shows who played and the scores; clicking opens
 * the game. `form` is recentForm(games, name).
 */
export default function FormGuide({ form, name, onSelectGame, size = "md" }) {
  const [tip, setTip] = useState(null); // { i, x, y, below }
  const pointer = useRef(null); // the last pointerdown's type, until its click
  const isTouch = () => pointer.current === "touch" || pointer.current === "pen";
  const root = useRef(null);

  useEffect(() => {
    if (!tip) return;
    const close = (e) => {
      if (!root.current?.contains(e.target)) setTip(null);
    };
    const hide = () => setTip(null);
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [tip]);

  if (!form.length) return <span className="k-muted">—</span>;

  const show = (i, el) => {
    const r = el.getBoundingClientRect();
    const below = r.top < 190;
    setTip({ i, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
  };
  const active = tip ? form[tip.i] : null;

  return (
    <span
      ref={root}
      className={`k-form k-form-${size}`}
      role="list"
      aria-label={`${name} — ბოლო ${form.length} თამაში`}
    >
      {form.map((f, i) => (
        <button
          key={f.game.id}
          type="button"
          role="listitem"
          className={`k-form-dot is-${f.result.toLowerCase()}${i === 0 ? " is-latest" : ""}`}
          aria-label={`${dateOf(f.game.playedAt)}: ${RESULT_LABELS[f.result]} — ${f.players
            .map((p) => `${p.name} ${p.score}`)
            .join(", ")}`}
          onPointerDown={(e) => {
            pointer.current = e.pointerType;
          }}
          onPointerEnter={(e) =>
            e.pointerType === "mouse" && show(i, e.currentTarget)
          }
          onPointerLeave={(e) => e.pointerType === "mouse" && setTip(null)}
          onFocus={(e) => !isTouch() && show(i, e.currentTarget)}
          onBlur={() => setTip(null)}
          onClick={(e) => {
            const touch = isTouch();
            pointer.current = null;
            // On touch the first tap only shows the details.
            if (touch && tip?.i !== i) {
              show(i, e.currentTarget);
              return;
            }
            onSelectGame?.(f.game);
          }}
        >
          {f.result}
        </button>
      ))}
      {active &&
        createPortal(
          <div
            className={`k-form-tip${tip.below ? " is-below" : ""}`}
            role="tooltip"
            style={{
              left: Math.min(Math.max(tip.x, 130), window.innerWidth - 130),
              top: tip.y,
            }}
          >
            <header>
              <span className={`k-form-dot is-${active.result.toLowerCase()}`}>
                {active.result}
              </span>
              <strong>{RESULT_LABELS[active.result]}</strong>
              <small>
                {dateOf(active.game.playedAt)} ·{" "}
                {active.game.type === "live" ? "LIVE" : "ONLINE"}
              </small>
            </header>
            <ol>
              {active.players.map((p) => (
                <li key={p.seat ?? p.name} className={p.name === name ? "is-me" : ""}>
                  <span>{p.name}</span>
                  <b>
                    {Number(p.score) > 0 ? "+" : ""}
                    {p.score}
                  </b>
                </li>
              ))}
            </ol>
            {onSelectGame && <footer>დააჭირე თამაშის სანახავად</footer>}
          </div>,
          document.body,
        )}
    </span>
  );
}
