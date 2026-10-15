// Season themes. Each season gets a look: the id is stored on the season
// row (seasons.theme) and applied as a `theme-<id>` class on <body>, which
// swaps the CSS custom properties defined in styles/main.css.
// `Icon` is a lucide-react component (same icon library King Online uses).

import { Club, Sun, Mountain, TreePine } from 'lucide-react'

export const SEASON_THEMES = [
  {
    id: 'casual',
    label: 'ჩვეულებრივი',
    Icon: Club,
    tagline: 'სუფთა და კლასიკური — ყოველდღიური მაგიდა',
  },
  {
    id: 'summer',
    label: 'ზაფხული',
    Icon: Sun,
    tagline: 'მზე, ზღვა და ქვიშიანი ქულები',
  },
  {
    id: 'mountain',
    label: 'მთა',
    Icon: Mountain,
    tagline: 'ფიჭვნარი, ქვა და მშვიდი ჰაერი',
  },
  {
    id: 'christmas',
    label: 'შობა',
    Icon: TreePine,
    tagline: 'თოვლი, შუქები და სადღესასწაულო წითელი',
  },
]

export const DEFAULT_THEME = 'casual'

export function getTheme(id) {
  return SEASON_THEMES.find(t => t.id === id) || SEASON_THEMES[0]
}

/** The body classes for a theme id (removes every other theme class). */
export function applyThemeToBody(id) {
  const theme = getTheme(id)
  SEASON_THEMES.forEach(t => document.body.classList.remove(`theme-${t.id}`))
  document.body.classList.add(`theme-${theme.id}`)
}
