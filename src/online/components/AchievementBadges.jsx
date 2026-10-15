import { ACHIEVEMENT_DEFS } from "../utils/achievements";
const GENERATED = new Set([
  "PERFECT_PLUS",
  "PLUS_PERFECTIONIST",
  "UNTOUCHABLE",
  "NEVER_BELOW_ZERO",
  "UNDERDOG",
  "RUNAWAY_WIN",
  "SHARED_WIN",
  "COMEBACK",
  "WIRE_TO_WIRE",
  "LAST_ROUND_STEAL",
  "PHOTO_FINISH",
  "CLEAN_SHEET",
  "KING_MAGNET",
  "DISASTER",
  "UGLY_WIN",
  "STREAK_BREAKER",
  "TOURNAMENT_WINNER",
  "SEASON_CHAMPION",
  "PERFECT_PLUS_HAT_TRICK",
  "GAMES_50",
  "GAMES_100",
  "GAMES_150",
  "GAMES_250",
  "GAMES_500",
  "GAMES_800",
  "GAMES_1000",
  "WINS_10",
  "WINS_25",
  "WINS_50",
  "WINS_250",
  "WINS_500",
  "WINS_1000",
  "WIN_STREAK_3",
  "WIN_STREAK_5",
  "WIN_STREAK_10",
  "CLUB_REGULAR",
]);
export function Emblem({ code, def }) {
  if (GENERATED.has(code))
    return (
      <img
        src={`/art/achievements/${code}.webp`}
        width="80"
        height="80"
        loading="lazy"
        decoding="async"
        alt=""
      />
    );
  const Icon = def.Icon;
  return (
    <span className="k-vector-emblem">
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <path
          d="M40 4 69 21 69 59 40 76 11 59 11 21Z"
          fill="#252b24"
          stroke="#7e8975"
        />
        <path
          d="m40 10 24 14v32L40 70 16 56V24Z"
          fill="none"
          stroke="#cad1b9"
          strokeWidth=".5"
        />
        <path d="M28 66h24" stroke="#d7fa52" strokeWidth="2" />
      </svg>
      <Icon size={28} strokeWidth={1.2} />
    </span>
  );
}
/**
 * `rarity` (optional): clubAchievementStats' badges by code, to say how
 * many players hold each one.
 */
export default function AchievementBadges({
  achievements,
  showLocked = false,
  rarity,
}) {
  const entries = Object.keys(ACHIEVEMENT_DEFS)
    .map((code) => [code, achievements?.[code] || 0])
    .filter(([, count]) => showLocked || count > 0);
  if (!entries.length) return null;
  return (
    <div className="k-achievements">
      {entries.map(([code, count]) => {
        const def = ACHIEVEMENT_DEFS[code];
        return (
          <div
            key={code}
            className={`k-achievement ${count > 0 ? "is-earned" : "is-locked"}`}
            title={`${def.label}: ${def.desc}${count > 1 ? ` (×${count})` : ""}`}
          >
            <div className="k-achievement-art">
              <Emblem code={code} def={def} />
            </div>
            <div>
              <strong>{def.label}</strong>
              <p>{def.desc}</p>
              {showLocked && (
                <span className="k-achievement-status">
                  {count > 0 ? "მოპოვებულია" : "ჯერ მოსაპოვებელია"}
                </span>
              )}
              {rarity?.[code] && (
                <span
                  className={`k-rarity is-${rarity[code].rarity.id}`}
                  title={`${rarity[code].holders.length} მოთამაშეს აქვს`}
                >
                  {rarity[code].rarity.label} ·{" "}
                  {Math.round(rarity[code].share * 100)}%
                </span>
              )}
            </div>
            {count > 1 && (
              <small className="k-achievement-count">×{count}</small>
            )}
          </div>
        );
      })}
    </div>
  );
}
