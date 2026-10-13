import { Check } from "lucide-react";
import { useGame } from "../context/GameContext";
import { GAME_TYPES } from "../constants/gameTypes";
export default function GameTypeMatrix() {
  const { players, usedTypes, chosenGameType } = useGame();
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  return (
    <section className="k-matrix-content">
      <p className="k-data-caption">
        ✓ ნათამაშებია · ცარიელი — დარჩენილია · ოქროსფერი — მიმდინარე.
      </p>
      <div className="k-table-scroll">
        <table className="k-data-table k-type-matrix">
          <thead>
            <tr>
              <th>თამაში</th>
              {sorted.map((p) => (
                <th key={p.seat} title={p.name}>
                  {p.name}
                  <small>{(usedTypes?.[p.seat] || []).length} / 9</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GAME_TYPES.map((t) => (
              <tr
                key={t.code}
                style={{ "--contract-color": t.color }}
                className={chosenGameType === t.code ? "is-current" : ""}
              >
                <th>
                  <span className="k-type-code">{t.code}</span>
                  <small>{t.name}</small>
                </th>
                {sorted.map((p) => (
                  <td
                    key={p.seat}
                    className={
                      (usedTypes?.[p.seat] || []).includes(t.code)
                        ? "is-played"
                        : "is-available"
                    }
                    aria-label={
                      (usedTypes?.[p.seat] || []).includes(t.code)
                        ? "ნათამაშებია"
                        : "ხელმისაწვდომია"
                    }
                  >
                    {(usedTypes?.[p.seat] || []).includes(t.code) ? (
                      <Check size={17} strokeWidth={3.5} />
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
