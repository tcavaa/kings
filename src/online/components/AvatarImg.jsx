import { useState } from "react";
import { Crown } from "lucide-react";
import { useLastChampions } from "../lib/champions.js";
const DEFAULT_AVATAR = "/art/player-mark.svg";

// Track errors by source: a new photo retries normally; broken photos show the mark.
export function AvatarPhoto({ avatar, className = "", ...props }) {
  const [failedSource, setFailedSource] = useState(null);
  const source = avatar || DEFAULT_AVATAR;
  const src = failedSource === source ? DEFAULT_AVATAR : source;
  return (
    <img
      {...props}
      key={source}
      src={src}
      alt=""
      className={className}
      onError={() => setFailedSource(source)}
    />
  );
}

/** The gold crown the last season's champion wears on their photo. */
export function ChampionCrown({ size = 14, className = "" }) {
  return (
    <span className={`k-champion-crown ${className}`} title="ბოლო სეზონის ჩემპიონი" aria-label="ბოლო სეზონის ჩემპიონი">
      <Crown size={size} fill="#f3ba45" color="#6b4300" strokeWidth={2} />
    </span>
  );
}

// `name` lets the photo crown the last season's champion.
export default function AvatarImg({ avatar, size = 24, className = "", name }) {
  const champions = useLastChampions();
  const photo = (
    <div
      className={`k-avatar overflow-hidden flex items-center justify-center bg-black flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <AvatarPhoto avatar={avatar} className="w-full h-full object-cover" />
    </div>
  );
  if (!name || !champions.has(name)) return photo;
  return (
    <span className="k-avatar-crowned">
      {photo}
      <ChampionCrown size={Math.max(12, Math.round(size * 0.42))} />
    </span>
  );
}
