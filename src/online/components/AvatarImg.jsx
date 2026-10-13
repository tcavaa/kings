import { useState } from "react";
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

export default function AvatarImg({ avatar, size = 24, className = "" }) {
  return (
    <div
      className={`k-avatar overflow-hidden flex items-center justify-center bg-black flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <AvatarPhoto avatar={avatar} className="w-full h-full object-cover" />
    </div>
  );
}
