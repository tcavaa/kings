module.exports = {
  // King Online only — the score app is plain CSS and must never get
  // Tailwind's preflight or utilities.
  content: ['./src/online/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        western: ['Noto Sans Georgian', 'Roboto Slab', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
