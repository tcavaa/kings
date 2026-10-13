import { lazy, Suspense } from "react";
import Sheet from "../ui/Sheet";
import ScoreTable from "../ScoreTable";
import GameTypeMatrix from "../GameTypeMatrix";
import LastTrickView from "../LastTrickView";
import WinProbability from "../WinProbability";

// ScoreChart is the only recharts consumer inside the game screen — loading
// it lazily keeps the ~80 kB (gzip) recharts chunk out of the GameLayout
// bundle until the player actually opens the chart tab.
const ScoreChart = lazy(() => import("../ScoreChart"));

const TITLES = {
  scores: "ქულები",
  matrix: "ნათამაშები ხელები",
  chart: "ქულების გრაფიკი",
  last: "ბოლოს გასული",
};

/**
 * Right-side slide-in drawer that hosts the four data views.
 *
 * The Tally Sheet is given a wider width than the others because it hosts a
 * full per-round score table — at the previous 320 px the table itself
 * needed an inner horizontal scrollbar, which is awkward on mobile.
 */
export default function ScoreDrawer({ panel, onClose }) {
  if (!panel) return null;
  return (
    <Sheet
      className={panel === "matrix" ? "k-matrix-drawer" : ""}
      drawer
      eyebrow="TABLE / INSIGHTS"
      title={TITLES[panel] || ""}
      onClose={onClose}
    >
      <div className="k-drawer-content">
        {panel === "scores" && (
          <>
            <ScoreTable />
            <WinProbability />
          </>
        )}
        {panel === "matrix" && (
          <>
            <GameTypeMatrix />
            <WinProbability />
          </>
        )}
        {panel === "last" && <LastTrickView />}
        {panel === "chart" && (
          <Suspense fallback={<p className="k-data-empty">იტვირთება…</p>}>
            <ScoreChart />
          </Suspense>
        )}
      </div>
    </Sheet>
  );
}
