import type { Config } from "tailwindcss";

/**
 * Tailwind v4 still reads a `tailwind.config.ts` when present — useful for
 * the `content` globs, the safelist, and a few semantic utility shortcuts.
 * The bulk of the theme lives in `app/globals.css` under `@theme inline`,
 * driven by the CSS variables exported from `lib/design.ts`.
 *
 * Sodium Vapor: amber phosphor on midnight. No purple. No Inter.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx,mdx}",
    "./components/**/*.{ts,tsx,mdx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        text: "var(--color-text)",
        "text-dim": "var(--color-text-dim)",
        accent: "var(--color-accent)",
        "accent-2": "var(--color-accent-2)",
        glow: "var(--color-glow)",
        danger: "var(--color-danger)",
        success: "var(--color-success)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
        body: ["var(--font-body)"],
        sans: ["var(--font-body)"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        callsign: "0.06em",
        morse: "0.35em",
      },
      boxShadow: {
        sodium: "0 0 0 1px var(--color-border), 0 12px 40px -16px rgba(255, 163, 11, 0.25)",
        "amber-inset": "inset 0 0 0 1px rgba(255, 163, 11, 0.4)",
      },
      animation: {
        "twr-pulse": "twr-pulse 1400ms ease-in-out infinite alternate",
        "scan-drift": "scan-drift 8s linear infinite",
      },
      keyframes: {
        "twr-pulse": {
          "0%": { opacity: "0.35", boxShadow: "0 0 0 0 rgba(255,163,11,0.0)" },
          "100%": { opacity: "1", boxShadow: "0 0 14px 2px rgba(255,209,102,0.55)" },
        },
        "scan-drift": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "0 6px" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
