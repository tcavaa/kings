/**
 * The homepage lists: who's online, which tables can be watched, open
 * tournaments and the bracket overview. The server broadcasts most of these
 * to every socket, so they feed the separate lobby context and never
 * re-render the table.
 */
export function registerLobbyEvents(socket, ctx) {
  const list = (l) => (Array.isArray(l) ? l : [])
  socket.on('online-players',      (l) => ctx.setOnlinePlayers(list(l)))
  socket.on('live-games',          (l) => ctx.setLiveGames(list(l)))
  socket.on('tournament-list',     (l) => ctx.setTournamentList(list(l)))
  socket.on('tournament-overview', (o) => ctx.setTournamentOverview(o))
}
