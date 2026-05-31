/**
 * Sodium Vapor — locked design tokens for the ham-callbook site.
 *
 * Vintage CRT amber phosphor + sodium-vapor street lamp palette,
 * with a brutalist-editorial typography stack. These tokens are the
 * single source of truth — frontend components MUST import from here
 * rather than hard-coding hex values or font names.
 *
 * Key naming follows the locked design spec exactly (snake_case for
 * tokens like `text_dim` and `accent_2`), so the shape here mirrors
 * what the design contract documents.
 */

export const colors = {
  bg: "#0a0e1a",
  surface: "#131a2d",
  border: "#2a3349",
  text: "#f5ecd9",
  text_dim: "#a8b0c3",
  accent: "#ffa30b",
  accent_2: "#c97e08",
  glow: "#ffd166",
  danger: "#ff5555",
  success: "#5dd3a8",
} as const;

export type ColorToken = keyof typeof colors;

/**
 * Font stacks. Display is Fraunces (variable serif with optical sizing —
 * use larger opsz on hero type for drama; Google Fonts). Mono is
 * JetBrains Mono for callsigns and any tabular data (Google Fonts). Body
 * is Geist Sans for prose (Vercel/Google).
 *
 * Each stack falls back through reasonable system fonts so SSR is safe
 * before web fonts load.
 */
export const fontStacks = {
  display:
    '"Fraunces", "Iowan Old Style", "Apple Garamond", "Baskerville", "Times New Roman", ui-serif, serif',
  mono: '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", ui-monospace, monospace',
  body: '"Geist Sans", "Geist", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
} as const;

export type FontStack = keyof typeof fontStacks;

/**
 * Human-readable descriptors for each font role, mirroring the locked
 * design spec verbatim. Use these in design-system docs / UI tooltips.
 */
export const fontDescriptors = {
  display: "Fraunces (variable serif, optical sizing for drama; Google Fonts)",
  mono: "JetBrains Mono (callsigns + data; Google Fonts)",
  body: "Geist Sans (clean modern body; Vercel/Google)",
} as const;

/**
 * Visual motifs that distinguish the site from generic AI-slop dark themes.
 * Each entry carries the locked one-line `label` from the design spec plus
 * concrete tuning values that concrete components (<Scanlines/>, <Grain/>,
 * <MorseDivider/>, <Sparkline/>, <TwrDot/>) read at render time.
 */
export const motifs = {
  scanlines: {
    label: "Subtle CRT scanlines on hero",
    description:
      "Faint horizontal lines, low opacity, blend-mode overlay. Hero/landing only — never inside data tables.",
    /** opacity of the horizontal scanline overlay (0-1) */
    opacity: 0.08,
    /** pixel spacing between scanlines */
    spacingPx: 3,
  },
  grain: {
    label: "Grain/noise overlay for warmth",
    description:
      "SVG fractal-noise turbulence, very low opacity, fixed-position pointer-events-none layer above bg.",
    opacity: 0.06,
    /** SVG turbulence baseFrequency for the noise filter */
    baseFrequency: 0.9,
  },
  morseDividers: {
    label: "Morse-code dashes used as decorative dividers",
    description:
      "Dot/dash glyph runs in JetBrains Mono, dim text color, letter-spaced. Replaces <hr> throughout the site.",
    /** ASCII pattern used as section divider — dits/dahs/spaces */
    pattern: "·  —  ·  ·  —  ·  ·  ·  —  —  ·",
    /** Tighter Unicode variant for inline use */
    tight: "·—··· —··· ·—·",
  },
  oscilloscope: {
    label: "ASCII oscilloscope sparklines for the timeline",
    description:
      "Per-year activity rendered as mono-spaced glyph rows; accent color, no chart library.",
    /** characters used, low → high amplitude */
    chars: "▁▂▃▄▅▆▇█",
  },
  asymmetricGrid: {
    label: "Asymmetric grids with wide left content + narrow marginalia",
    description:
      "12-col grid: content occupies cols 1-8, marginalia (year ticks, dataset notes, license-class key) cols 9-12.",
    /** CSS grid template — wide main column, narrow right rail */
    gridTemplate: "minmax(0, 1fr) minmax(0, 18rem)",
  },
  glow: {
    label: "Glow on accent text (soft amber halo)",
    description:
      "Used on hero callsign, active nav, and the TWR dot. Layered text-shadow gives the sodium-vapor halo.",
    /** CSS text-shadow value referencing the glow color */
    textShadow:
      "0 0 12px rgba(255, 209, 102, 0.45), 0 0 2px rgba(255, 163, 11, 0.7)",
  },
  twrIndicator: {
    label: "Animated TWR (transmit-receive) indicator dot on header",
    description:
      "Small accent-filled circle, pulsing easing alternate. Signals 'live' status of the search service.",
    /** ms per pulse cycle */
    pulseMs: 1400,
    sizePx: 8,
  },
} as const;

export type MotifKey = keyof typeof motifs;

/**
 * Convenience: pre-baked CSS variable map. The root layout spreads this
 * onto :root so components can use `var(--color-accent)` etc., and
 * Tailwind v4's `@theme inline` can reference the same values.
 */
export const cssVariables: Record<string, string> = {
  "--color-bg": colors.bg,
  "--color-surface": colors.surface,
  "--color-border": colors.border,
  "--color-text": colors.text,
  "--color-text-dim": colors.text_dim,
  "--color-accent": colors.accent,
  "--color-accent-2": colors.accent_2,
  "--color-glow": colors.glow,
  "--color-danger": colors.danger,
  "--color-success": colors.success,
  "--font-display": fontStacks.display,
  "--font-mono": fontStacks.mono,
  "--font-body": fontStacks.body,
};
