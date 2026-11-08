import { ArrowUpRight, Plus, Check, LogOut } from "lucide-react";
import { useGame, useLobby } from "../context/GameContext";
import AvatarImg from "./AvatarImg";

// The homepage league tables (every King Online table is a league table):
// a 3-seat one, and under it a 4-seat one where each round's dealer rests.
const MODE = "championship";
const TABLES = [
  { key: "championship", seatCount: 3, rounds: 27, label: "3 მოთამაშე" },
  { key: "championship4", seatCount: 4, rounds: 36, label: "4 მოთამაშე" },
];

/** "12 / 40" — this season's league games (capped at the season's limit). */
function seasonGamesLabel(quota) {
  if (!quota) return "— სეზონში";
  if (quota.limit == null) return `${quota.played} სეზონში`;
  return `${Math.min(quota.played, quota.limit)} / ${quota.limit} სეზონში`;
}

export default function PublicRoomPanel({ active, quota, onNeedProfile }) {
  const seasonFull = quota?.limit != null && quota.played >= quota.limit;
  return (
    <div className="k-matchmaking">
      <div className="k-match-intro">
        <span className="k-eyebrow">PLAY FOR YOUR PLACE</span>
        <h3>
          შენი თამაში.
          <br />
          შენი რეიტინგი.
        </h3>
        <p>
          ყოველი შედეგი სეზონის ნაწილია. დაიკავე ადგილი და აჩვენე შენი საუკეთესო თამაში.
        </p>
        <div className="k-match-meta">
          <span>3 ან 4 მოთამაშე</span>
          <span title="სეზონი თითო მოთამაშის პირველ 40 თამაშს ითვლის">
            {seasonGamesLabel(quota)}
          </span>
        </div>
        {seasonFull && (
          <p className="k-season-full" role="status">
            სეზონის {quota.limit} თამაში ამოიწურა — თამაში შეგიძლია, მაგრამ
            მოგებები ამ სეზონს აღარ დაემატება.
          </p>
        )}
      </div>
      <div className="k-match-tables">
        {TABLES.map((t) => (
          <QuickTable key={t.key} table={t} active={active} onNeedProfile={onNeedProfile} />
        ))}
      </div>
    </div>
  );
}

function QuickTable({ table: t, active, onNeedProfile }) {
  const {
    connected,
    publicSeat,
    publicSeatMode,
    sitPublic,
    standPublic,
    setPublicEmoji,
    inTournament,
  } = useGame();
  const { publicRoom } = useLobby();
  const view = publicRoom?.[t.key] || { seats: [] };
  const seats = view.seats || [];
  const seated = publicSeat !== null;
  const here = seated && publicSeatMode === t.key;
  // One table at a time: not while entered in a tournament.
  const canSit = connected && !seated && !inTournament && seats.length < t.seatCount;
  const join = () =>
    active ? canSit && sitPublic(active.name, null, MODE, t.seatCount) : onNeedProfile?.();
  return (
    <div className={`k-match-seating ${t.seatCount === 4 ? "is-four" : ""}`}>
      <div className="k-seat-heading">
        <span>
          <i className="k-live-dot" />
          {t.label} · {t.rounds} რაუნდი
        </span>
        <b>
          {seats.length}
          <small> / {t.seatCount}</small>
        </b>
      </div>
      <div className="k-seat-line" style={{ "--k-seats": t.seatCount }}>
        {Array.from({ length: t.seatCount }, (_, i) => {
          const p = seats.find((s) => s.seat === i);
          const mine = here && publicSeat === i;
          return (
            <div className={`k-seat ${mine ? "is-mine" : ""}`} key={i}>
              <button
                className="k-seat-avatar"
                type="button"
                onClick={p ? undefined : join}
                disabled={!!p || (active ? !canSit : !connected)}
                aria-label={
                  p ? `${p.name} — დაკავებულია` : `დაიკავე თავისუფალი ადგილი ${i + 1} (${t.label})`
                }
              >
                {p ? <AvatarImg avatar={p.avatar} name={p.name} size={58} /> : <Plus size={22} />}
                {p && (
                  <span className="k-seat-check">
                    <Check size={10} />
                  </span>
                )}
              </button>
              <strong>{p?.name || "შენი ადგილი"}</strong>
              <small>{mine ? "შენ მაგიდასთან ხარ" : p ? "მზადაა" : "თავისუფალია"}</small>
              {p?.emoji && <span>{p.emoji}</span>}
            </div>
          );
        })}
      </div>
      <div className="k-match-action">
        <button
          className={`k-button ${here ? "k-button-outline" : ""}`}
          onClick={here ? standPublic : join}
          disabled={active ? !here && !canSit : false}
        >
          {here ? (
            <>
              მაგიდის დატოვება <LogOut size={17} />
            </>
          ) : (
            <>
              {active ? `დაიკავე ადგილი · ${t.label}` : "აირჩიე პროფილი"}
              <ArrowUpRight size={20} />
            </>
          )}
        </button>
        <small role="status">
          {here
            ? `ველოდებით კიდევ ${t.seatCount - seats.length} მოთამაშეს`
            : seated
              ? "უკვე ზიხარ სხვა მაგიდასთან"
              : !connected
                ? "სერვერთან დაკავშირება…"
                : t.seatCount === 4
                  ? "ყოველ ხელში დამრიგებელი ისვენებს."
                  : "მზად ხარ შემდეგი სვლისთვის?"}
        </small>
      </div>
      {here && (
        <div className="k-reactions" aria-label="რეაქცია">
          {["👋", "🔥", "😎", "🃏"].map((e) => (
            <button key={e} onClick={() => setPublicEmoji(e)} aria-label={`რეაქცია ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
