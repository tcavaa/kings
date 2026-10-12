import { ArrowUpRight, Plus, Check, LogOut } from "lucide-react-online";
import { useGame } from "../context/GameContext";
import AvatarImg from "./AvatarImg";

export default function PublicRoomPanel({
  active,
  mode = "public",
  quota,
  onNeedProfile,
}) {
  const {
    connected,
    publicRoom,
    publicSeat,
    publicSeatMode,
    sitPublic,
    standPublic,
    setPublicEmoji,
  } = useGame();
  const table = publicRoom?.[mode] || { seats: [] };
  const seats = table.seats || [];
  const seated = publicSeat !== null;
  const here = seated && publicSeatMode === mode;
  const ranked = mode === "championship";
  const quotaSpent = ranked && quota != null && quota.remaining <= 0;
  const canSit = connected && !seated && !quotaSpent && seats.length < 3;
  const join = () =>
    active
      ? canSit && sitPublic(active.name, active.avatar, null, mode)
      : onNeedProfile?.();
  return (
    <div className="k-matchmaking">
      <div className="k-match-intro">
        <span className="k-eyebrow">
          {ranked ? "PLAY FOR YOUR PLACE" : "THE ORIGINAL, REIMAGINED"}
        </span>
        <h3>
          {ranked ? (
            <>
              შენი თამაში.
              <br />
              შენი რეიტინგი.
            </>
          ) : (
            <>
              სამი მოთამაშე.
              <br />
              სუფთა სტრატეგია.
            </>
          )}
        </h3>
        <p>
          {ranked
            ? "ყოველი შედეგი სეზონის ნაწილია. დაიკავე ადგილი და აჩვენე შენი საუკეთესო თამაში."
            : "კლასიკური კინგი, ზედმეტი ხმაურის გარეშე. მაგიდა შეივსება და თამაში ავტომატურად დაიწყება."}
        </p>
        <div className="k-match-meta">
          <span>27 რაუნდი</span>
          <span>
            {ranked
              ? `${quota?.remaining ?? "—"} / ${quota?.limit ?? 8} დღეს`
              : "მეგობრული თამაში"}
          </span>
        </div>
      </div>
      <div className="k-match-seating">
        <div className="k-seat-heading">
          <span>
            <i className="k-live-dot" />
            LIVE TABLE
          </span>
          <b>
            {seats.length}
            <small> / 3</small>
          </b>
        </div>
        <div className="k-seat-line">
          {[0, 1, 2].map((i) => {
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
                    p
                      ? `${p.name} — დაკავებულია`
                      : `დაიკავე თავისუფალი ადგილი ${i + 1}`
                  }
                >
                  {p ? (
                    <AvatarImg avatar={p.avatar} size={58} />
                  ) : (
                    <Plus size={22} />
                  )}
                  {p && (
                    <span className="k-seat-check">
                      <Check size={10} />
                    </span>
                  )}
                </button>
                <strong>{p?.name || "შენი ადგილი"}</strong>
                <small>
                  {mine ? "შენ მაგიდასთან ხარ" : p ? "მზადაა" : "თავისუფალია"}
                </small>
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
                {active ? "დაიკავე ადგილი" : "აირჩიე პროფილი"}
                <ArrowUpRight size={20} />
              </>
            )}
          </button>
          <small role="status">
            {here
              ? `ველოდებით კიდევ ${3 - seats.length} მოთამაშეს`
              : quotaSpent
                ? "დღის ლიმიტი ამოიწურა"
                : seated
                  ? "უკვე ზიხარ სხვა მაგიდასთან"
                  : !connected
                    ? "სერვერთან დაკავშირება…"
                    : "მზად ხარ შემდეგი სვლისთვის?"}
          </small>
        </div>
        {here && (
          <div className="k-reactions" aria-label="რეაქცია">
            {["👋", "🔥", "😎", "🃏"].map((e) => (
              <button
                key={e}
                onClick={() => setPublicEmoji(e)}
                aria-label={`რეაქცია ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
