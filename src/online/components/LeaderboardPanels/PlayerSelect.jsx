import { useState } from "react";

/**
 * The player an Insights panel shows. Falls back to the first name whenever
 * the stored choice is no longer in the list (the game-type filter changed),
 * so the dropdown and the data always agree.
 */
export function usePlayerChoice(names) {
  const [selected, setSelected] = useState("");
  const name = names.includes(selected) ? selected : names[0] || "";
  return [name, setSelected];
}

/** The panel-header dropdown that goes with usePlayerChoice. */
export default function PlayerSelect({ names, value, onChange, label }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {names.map((n) => (
        <option key={n}>{n}</option>
      ))}
    </select>
  );
}
