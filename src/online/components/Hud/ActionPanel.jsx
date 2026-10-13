import { memo } from "react";
import { Layers, ArrowUpRight } from "lucide-react";
function ActionPanel({ onLastTrick }) {
  return (
    <button
      className="k-last-trick"
      onClick={onLastTrick}
      aria-label="ბოლო გათამაშების ნახვა"
    >
      <span>
        <Layers size={19} />
      </span>
      <span>
        <small>REPLAY</small>
        <b>ბოლო გათამაშება</b>
      </span>
      <ArrowUpRight size={17} />
    </button>
  );
}
export default memo(ActionPanel);
