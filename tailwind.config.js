module.exports = {
  // King Online only — the score app is plain CSS and must never get
  // Tailwind's preflight or utilities.
  content: ['./src/online/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Georgian tavern palette (key names kept for back-compat)
        wood:        '#091211',
        'wood-dark': '#070e0d',
        'wood-light':'#223b35',
        leather:     '#11211e',
        saddle:      '#294238',
        rust:        '#d5b982',
        'rust-bright':'#e5cc9c',
        cream:       '#172725',
        parchment:   '#0c1716',
        ink:         '#eeeae1',
        amber:       '#d5b982',
        'amber-deep':'#baa278',
        sage:        '#7ac7a5',
        wine:        '#d5b982',
        'wine-deep': '#284b41',
        // Back-compat aliases used by older components
        'casino-bg':     '#0c1716',
        'casino-panel':  '#172725',
        'casino-border': 'rgba(151,176,162,0.42)',
        gold:            '#d5b982',
        'accent-green':  '#7ac7a5',
        'accent-red':    '#ef918b',
      },
      fontFamily: {
        western: ['Noto Sans Georgian', 'Roboto Slab', 'Georgia', 'serif'],
        slab:    ['Noto Sans Georgian', 'Roboto Slab', 'Georgia', 'serif'],
        type:    ['Inter', 'Noto Sans Georgian', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
