module.exports = {
  // King Online only — the score app is plain CSS and must never get
  // Tailwind's preflight or utilities.
  content: ['./src/online/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // next/font's generated family (app/(online)/layout.jsx).
        western: ['var(--font-noto-georgian)', 'Roboto Slab', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
