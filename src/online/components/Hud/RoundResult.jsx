import { useEffect, useState } from "react";
import { useGame } from "../../context/GameContext";
import { getGameType } from "../../constants/gameTypes";
import { quoteForRound } from "../../constants/quotes";
import ModalShell from "../ModalShell";
import AvatarImg from "../AvatarImg";

// The server deals the next hand on its own this long after the result opens
// (see server/socket/gameFlow.js) — there is no "next round" button.
const NEXT_ROUND_SECONDS = 4;
// Still here well after that (a table restored after a server restart has no
// timer): ask the server to deal. It ignores the ask while its own timer runs.
const NUDGE_AFTER_MS = 7000;

export default function RoundResult() {
  const {
    round,
    chosenGameType,
    roundScores,
    cumulativeScores,
    players,
    mySeat,
    nextRound,
    roomCode,
    spectating,
    roundDetails,
  } = useGame();
  // The dealer who sat this round out at a 4-player table.
  const resting = (roundDetails || []).find((d) => d.round === round)?.restingSeat;
  const [left, setLeft] = useState(NEXT_ROUND_SECONDS);
  useEffect(() => {
    setLeft(NEXT_ROUND_SECONDS);
    const started = Date.now();
    const tick = setInterval(() => {
      setLeft(Math.max(0, NEXT_ROUND_SECONDS - Math.floor((Date.now() - started) / 1000)));
    }, 250);
    const nudge = !spectating && mySeat !== null && mySeat !== undefined
      ? setTimeout(() => nextRound(), NUDGE_AFTER_MS)
      : null;
    return () => {
      clearInterval(tick);
      if (nudge) clearTimeout(nudge);
    };
    // A new round number is a new result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  const last = roundScores[roundScores.length - 1],
    type = getGameType(chosenGameType),
    quote = quoteForRound(roomCode, round);
  return (
    <ModalShell
      className="items-center z-40 p-3 overflow-y-auto"
      panelClassName="k-contract-modal k-round-result max-w-lg my-auto"
    >
      <div className="k-round-heading">
        <div>
          <span className="k-eyebrow">ONE HAND CLOSER</span>
          <h2>ხელი დასრულდა.</h2>
          <small>{type?.name || "კინგი"}</small>
        </div>
        <strong>{String(round).padStart(2, "0")}</strong>
      </div>
      <div className="k-round-scores">
        <header>
          <span>მოთამაშე</span>
          <span>ეს ხელი</span>
          <span>ჯამი</span>
        </header>
        {[...players]
          .sort(
            (a, b) =>
              (cumulativeScores[b.seat] || 0) - (cumulativeScores[a.seat] || 0),
          )
          .map((p) => {
            const delta = last?.scores?.[p.seat] || 0;
            return (
              <div key={p.seat}>
                <span>
                  <AvatarImg avatar={p.avatar} name={p.name} size={32} />
                  {p.name}
                </span>
                {p.seat === resting ? (
                  <b className="resting" title="ისვენებდა">—</b>
                ) : (
                  <b className={delta < 0 ? "negative" : "positive"}>
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </b>
                )}
                <strong>{cumulativeScores[p.seat] ?? 0}</strong>
              </div>
            );
          })}
      </div>
      <blockquote>
        „{quote.text}“<small>— {quote.author}</small>
      </blockquote>
      <div className="k-round-action">
        <p role="status" aria-live="polite">
          {left > 0 ? `შემდეგი ხელი ${left} წამში…` : "ახალი ხელი რიგდება…"}
        </p>
        <div className="k-round-countdown" aria-hidden="true">
          <i style={{ animationDuration: `${NEXT_ROUND_SECONDS}s` }} key={round} />
        </div>
      </div>
    </ModalShell>
  );
}
