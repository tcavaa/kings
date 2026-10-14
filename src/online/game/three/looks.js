import { api } from "../../lib/api";

// Players without a profile (typed names) get a default look per seat.
const DEFAULT_LOOK = { gender: "male", head: null };
const lookCache = new Map();
/** { [seat]: { gender, head } } for a roster, from the players' profiles. */
export async function looksFor(players) {
  const ids = players.map((p) => p.profileId).filter(Boolean);
  const missing = ids.filter((id) => !lookCache.has(id));
  if (missing.length) {
    try {
      const found = await api.getCharacters(missing);
      for (const id of missing)
        lookCache.set(id, found?.[id] || DEFAULT_LOOK);
    } catch {
      /* the default cast stands in */
    }
  }
  return Object.fromEntries(
    players.map((p) => [
      p.seat,
      (p.profileId && lookCache.get(p.profileId)) || DEFAULT_LOOK,
    ]),
  );
}
export function forgetLook(profileId) {
  lookCache.delete(profileId);
}
