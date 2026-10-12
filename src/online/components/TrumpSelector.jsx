import { useState, useMemo } from "react";
import { ArrowRight, Heart, Diamond, Spade, Club } from "lucide-react-online";
import { useGame } from "../context/GameContext";
import ModalShell from "./ModalShell";

const SUITS = [
  { code: "S", Icon: Spade, name: "ყვავი", color: "#1a1a1a" },
  { code: "H", Icon: Heart, name: "გული", color: "#a31818" },
  { code: "D", Icon: Diamond, name: "აგური", color: "#a31818" },
  { code: "C", Icon: Club, name: "ჯვარი", color: "#1a1a1a" },
];

import PlayingCard from "./ui/PlayingCard";
function HandPreviewCard({ card, isTrump }) {
  return <PlayingCard card={card} highlight={isTrump} />;
}

export default function TrumpSelector() {
  const { selectTrump, leaderSeat, players, chosenGameType, hand } = useGame();
  const [picked, setPicked] = useState(null);

  const leaderName =
    players.find((p) => p.seat === leaderSeat)?.name ??
    `მოთამაშე ${leaderSeat}`;

  const suitCounts = useMemo(() => {
    const counts = { H: 0, D: 0, S: 0, C: 0 };
    for (const c of hand || []) counts[c.suit] = (counts[c.suit] || 0) + 1;
    return counts;
  }, [hand]);

  return (
    <ModalShell
      className="items-center z-30 p-3 overflow-y-auto"
      panelClassName="k-contract-modal max-w-2xl my-auto"
    >
      <div className="k-contract-heading">
        <div>
          <span className="k-eyebrow">CHOOSE YOUR ADVANTAGE</span>
          <h2>შენი ძლიერი ფერი.</h2>
        </div>
        <span>
          {leaderName}
          <small>{chosenGameType} / კოზირის არჩევა</small>
        </span>
      </div>
      <div className="k-trump-body">
        <div className="k-trump-hand">
          {hand.map((c, i) => (
            <HandPreviewCard key={i} card={c} isTrump={picked === c.suit} />
          ))}
        </div>
        <p>კოზირი სხვა ფერის კარტს ჯობია. აირჩიე შენი უპირატესობა.</p>
        <div className="k-suit-choices">
          {SUITS.map((s) => (
            <button
              key={s.code}
              aria-pressed={picked === s.code}
              onClick={() => setPicked(s.code)}
            >
              <s.Icon size={40} strokeWidth={1.4} />
              <strong>{s.name}</strong>
              <small>{suitCounts[s.code]} კარტი ხელში</small>
            </button>
          ))}
        </div>
      </div>
      <footer className="k-contract-footer">
        <button className="k-link" onClick={() => selectTrump(null)}>
          ვითამაშოთ უკოზიროდ
        </button>
        <button
          className="k-button"
          disabled={!picked}
          onClick={() => picked && selectTrump(picked)}
        >
          დაადასტურე არჩევანი <ArrowRight size={18} />
        </button>
      </footer>
    </ModalShell>
  );
}
