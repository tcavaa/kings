// Tailwind only acts on files that use its directives — King Online's
// stylesheet. The score app's plain CSS passes through untouched.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
