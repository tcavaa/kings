import AvatarImg from "./AvatarImg";
const FIELDS = [
  ["roundsLed", "წაყვანილი რაუნდები"],
  ["totalTricks", "აღებული მინუსები"],
  ["queens", "დამები"],
  ["jacks", "ვალეტები"],
  ["hearts", "გულები"],
  ["kingsOfHearts", "გულის მეფე"],
];
export default function PlayerStatsCards({ playerList, stats }) {
  return (
    <section className="k-player-reports">
      {playerList.map((p) => (
        <article key={p.seat}>
          <header>
            <AvatarImg avatar={p.avatar} size={32} />
            <strong>{p.name}</strong>
          </header>
          <dl>
            {FIELDS.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{stats[p.seat]?.[key] ?? 0}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </section>
  );
}
