import {
  ArrowUpRight,
  Grid2X2,
  Trophy,
  ArrowLeft,
  UserRound,
  NotebookPen,
} from "lucide-react-online";

// The score keeper (King Score) lives at /score under its own root layout,
// so getting there is a full page load rather than an in-app view.
export const SCORE_APP_PATH = "/score";
export function openScoreApp() {
  window.location.assign(SCORE_APP_PATH);
}

export function Wordmark() {
  return (
    <span className="k-wordmark">
      k<span>ı</span>ng<sup>®</sup>
    </span>
  );
}

export default function ClubShell({
  children,
  page = "play",
  onHome,
  onLeaderboard,
  onProfile,
  profile,
  connected,
  title,
}) {
  return (
    <div className="k-shell">
      <aside className="k-rail">
        <button className="k-logo" onClick={onHome} aria-label="KING მთავარი">
          <Wordmark />
        </button>
        <span className="k-rail-caption">A DIFFERENT KIND OF CLUB.</span>
        <nav aria-label="მთავარი ნავიგაცია">
          <button
            aria-label="სათამაშო სივრცე"
            className={page === "play" ? "active" : ""}
            onClick={onHome}
            aria-current={page === "play" ? "page" : undefined}
          >
            <Grid2X2 size={20} />
            <span>სათამაშო სივრცე</span>
            <ArrowUpRight size={16} />
          </button>
          {onLeaderboard && (
            <button
              aria-label="ლიდერბორდი"
              className={page === "rankings" ? "active" : ""}
              onClick={onLeaderboard}
              aria-current={page === "rankings" ? "page" : undefined}
            >
              <Trophy size={20} />
              <span>ლიდერბორდი</span>
              <ArrowUpRight size={16} />
            </button>
          )}
          <button aria-label="ჩაწერა" onClick={openScoreApp}>
            <NotebookPen size={20} />
            <span>ჩაწერა</span>
            <ArrowUpRight size={16} />
          </button>
        </nav>
        <div className="k-rail-bottom">
          <span className="k-rail-suit">♠</span>
          <p>
            კარგი სვლა
            <br />
            ყველაფერს ცვლის.
          </p>
          <span>EST. FOR THE PLAYERS</span>
        </div>
      </aside>
      <div className="k-shell-body">
        <header className="k-topline">
          <span>
            <span className="k-breadcrumb">THE CLUB /</span>{" "}
            {title || "სათამაშო სივრცე"}
          </span>
          <div>
            {typeof connected === "boolean" && (
              <span className="k-connection">
                <i className={connected ? "on" : ""} />
                {connected ? "ონლაინ" : "დაკავშირება…"}
              </span>
            )}
            {onProfile ? (
              <button className="k-account" onClick={onProfile}>
                <UserRound size={16} />
                <span>{profile?.name || "შენი პროფილი"}</span>
                <ArrowUpRight size={14} />
              </button>
            ) : (
              onHome && (
                <button
                  className="k-icon-button"
                  onClick={onHome}
                  aria-label="უკან"
                >
                  <ArrowLeft size={18} />
                </button>
              )
            )}
          </div>
        </header>
        <main className="k-content">{children}</main>
        <footer className="k-footer">
          <Wordmark />
          <span>PLAY WITH INTENT.</span>
          <span>კინგი · ახალი თაობა</span>
        </footer>
      </div>
    </div>
  );
}
