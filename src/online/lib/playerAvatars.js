// Scores remain historical; identity photos follow the current profile, including removal.
export function withCurrentAvatars(games, profiles) {
  const byName = new Map(profiles.map((p) => [p.name, p.avatar || null]));
  return games.map((game) => ({
    ...game,
    players: (game.players || []).map((player) =>
      byName.has(player.name)
        ? { ...player, avatar: byName.get(player.name) }
        : player,
    ),
  }));
}
