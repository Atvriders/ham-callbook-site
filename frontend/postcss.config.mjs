/**
 * Tailwind v4 ships its PostCSS plugin separately as `@tailwindcss/postcss`.
 * Autoprefixer is kept for legacy Safari/iOS quirks around backdrop-filter
 * and conic-gradient — both used in the Sodium Vapor hero treatment.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};

export default config;
