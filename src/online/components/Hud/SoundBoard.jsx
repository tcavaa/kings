import { useState, useEffect, useRef } from "react";
import { AudioLines, Play } from "lucide-react";
import { useGame, useChat } from "../../context/GameContext";
import { getSounds, subscribeSounds } from "../../lib/soundRegistry";
import Sheet from "../ui/Sheet";
// Golden-angle spacing gives every catalogue entry its own accent hue.
function soundStyle(index) {
  const hue = Math.round((index * 137.508 + 155) % 360);
  return {
    "--sound-color": `hsl(${hue} 78% 35%)`,
    "--sound-bg": `hsl(${hue} 85% 91%)`,
    "--sound-border": `hsl(${hue} 68% 68%)`,
  };
}
export default function SoundBoard() {
  const { mySeat } = useGame();
  const { playSound, canSpeak } = useChat();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const timer = useRef(null);
  const [sounds, setSoundList] = useState(getSounds);
  useEffect(() => subscribeSounds(setSoundList), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!canSpeak) return null;
  const fire = (id) => {
    playSound?.(id, mySeat);
    setFlash(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 500);
  };
  return (
    <>
      <section className="k-desktop-sounds" aria-label="თამაშის ხმები">
        <header>
          <AudioLines size={16} />
          <span>მაგიდის ხმები</span>
          <small>{sounds.length}</small>
        </header>
        <div className="k-direct-sounds">
          {sounds.map((s, i) => (
            <button
              key={s.id}
              style={soundStyle(i)}
              title={s.label}
              aria-label={`ხმის დაკვრა: ${s.label}`}
              className={flash === s.id ? "is-playing" : ""}
              onClick={() => fire(s.id)}
            >
              <Play size={11} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </section>
      <button
        className="k-voice-trigger"
        aria-label="ხმების გახსნა"
        onClick={() => setOpen(true)}
      >
        <AudioLines size={20} />
        <span>ხმები</span>
      </button>
      {open && (
        <Sheet
          onClose={() => setOpen(false)}
          title="ხმის კოლექცია"
          eyebrow="TABLE / AUDIO"
        >
          <p className="k-muted">აირჩიე ხმა და გაუზიარე მაგიდას.</p>
          <div className="k-sound-library">
            {sounds.map((s, i) => (
              <button
                key={s.id}
                style={soundStyle(i)}
                onClick={() => fire(s.id)}
                className={flash === s.id ? "is-playing" : ""}
              >
                <small>{String(i + 1).padStart(2, "0")}</small>
                <span>{s.label}</span>
                {flash === s.id ? <AudioLines size={18} /> : <Play size={15} />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
