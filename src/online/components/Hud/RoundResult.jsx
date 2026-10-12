import { ArrowRight } from "lucide-react-online";
import { useGame } from "../../context/GameContext";
import { getGameType } from "../../constants/gameTypes";
import { quoteForRound } from "../../constants/quotes";
import ModalShell from "../ModalShell";
import AvatarImg from "../AvatarImg";
export default function RoundResult() {
  const {
    round,
    chosenGameType,
    roundScores,
    cumulativeScores,
    players,
    isCreator,
    nextRound,
    roomCode,
  } = useGame();
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
                  <AvatarImg avatar={p.avatar} size={32} />
                  {p.name}
                </span>
                <b className={delta < 0 ? "negative" : "positive"}>
                  {delta > 0 ? "+" : ""}
                  {delta}
                </b>
                <strong>{cumulativeScores[p.seat] ?? 0}</strong>
              </div>
            );
          })}
      </div>
      <blockquote>
        „{quote.text}“<small>— {quote.author}</small>
      </blockquote>
      <div className="k-round-action">
        {isCreator ? (
          <button className="k-button" onClick={nextRound}>
            შემდეგი ხელი <ArrowRight size={18} />
          </button>
        ) : (
          <p role="status">ველოდებით წამყვანს…</p>
        )}
      </div>
    </ModalShell>
  );
}
