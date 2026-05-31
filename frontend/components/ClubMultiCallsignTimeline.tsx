"use client";

/**
 * ClubMultiCallsignTimeline — horizontal phosphor-amber timeline of
 * multiple callsigns held by a single club / institutional licensee.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts
 * so colour + type stay in lockstep with the rest of the site.
 *
 * Visual concept:
 *   - A horizontal time axis from 1909 → 1997 ("the long century" of
 *     printed callbooks), rendered as a thin amber rule with year tick
 *     marks every decade and faint per-year tick marks between.
 *   - Each callsign occupies its own row band (60 px tall). The band
 *     is a tinted amber bar stretching from first_year → last_year,
 *     with the callsign label inside in JetBrains Mono — text-shadow
 *     glow gives the sodium-vapor halo.
 *   - Subtle CRT scanlines + SVG turbulence grain overlay the chart,
 *     and a morse-code rune divider sits under the heading.
 *   - Motion (framer-motion / motion) drives a staggered entrance:
 *     axis fades in first, then each band wipes out left-to-right.
 *   - Hover on a band swaps the fill to a darker amber and reveals a
 *     monospaced tooltip with the appearance_count.
 *
 * No chart library, no shadcn primitives, no Inter — everything is
 * raw SVG + a thin overlay of HTML for the tooltip.
 */

import { useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { colors, fontStacks, motifs } from "@/lib/design";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClubCallsignEntry {
  callsign: string;
  first_year: number;
  last_year: number;
  appearance_count: number;
}

export interface ClubMultiCallsignTimelineProps {
  callsigns: ClubCallsignEntry[];
  /** Inclusive [min, max] year range for the axis. Defaults to [1909, 1997]. */
  yearRange?: [number, number];
}

// ---------------------------------------------------------------------------
// Geometry / layout constants — kept here so the component is self-contained.
// ---------------------------------------------------------------------------

const DEFAULT_RANGE: [number, number] = [1909, 1997];
const ROW_HEIGHT = 60;
const ROW_GAP = 8;
const BAND_HEIGHT = 44; // shorter than row so axis breathes
const LEFT_GUTTER = 96; // room for the y-axis callsign labels
const RIGHT_GUTTER = 24;
const AXIS_TOP_PAD = 36;
const AXIS_BOTTOM_PAD = 56;
const MIN_BAND_WIDTH = 18; // single-year holdings still get a visible block

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClubMultiCallsignTimeline({
  callsigns,
  yearRange = DEFAULT_RANGE,
}: ClubMultiCallsignTimelineProps) {
  const [yMin, yMax] = yearRange;

  // Stable sort: earliest first_year first, then longest tenure. Keeps the
  // visual reading order chronological even when caller passes an arbitrary
  // input array (e.g. alphabetical by callsign).
  const rows = useMemo(() => {
    return [...callsigns].sort((a, b) => {
      if (a.first_year !== b.first_year) return a.first_year - b.first_year;
      const aLen = a.last_year - a.first_year;
      const bLen = b.last_year - b.first_year;
      return bLen - aLen;
    });
  }, [callsigns]);

  // Hover state for tooltip + emphasis swap. Tracked at parent level so the
  // tooltip can absolutely-position over the whole chart area.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ViewBox dimensions. We render in a fluid SVG; the parent controls width
  // via CSS. Height grows with row count.
  const innerWidth = 1000; // arbitrary viewBox width; SVG scales to container
  const totalRows = rows.length;
  const chartHeight =
    AXIS_TOP_PAD + totalRows * (ROW_HEIGHT + ROW_GAP) + AXIS_BOTTOM_PAD;

  // Helper: map a year to an x-coordinate in the SVG viewBox.
  const xForYear = (year: number) => {
    const usable = innerWidth - LEFT_GUTTER - RIGHT_GUTTER;
    const t = (year - yMin) / (yMax - yMin);
    return LEFT_GUTTER + Math.max(0, Math.min(1, t)) * usable;
  };

  // Decade tick years — 1910, 1920, ... up to yMax.
  const decadeTicks = useMemo(() => {
    const ticks: number[] = [];
    const start = Math.ceil(yMin / 10) * 10;
    for (let y = start; y <= yMax; y += 10) ticks.push(y);
    return ticks;
  }, [yMin, yMax]);

  // Per-year minor ticks — every year that's NOT a decade tick.
  const minorTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let y = yMin; y <= yMax; y++) {
      if (y % 10 !== 0) ticks.push(y);
    }
    return ticks;
  }, [yMin, yMax]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 2,
        padding: "28px 24px 20px 24px",
        fontFamily: fontStacks.body,
        color: colors.text,
        overflow: "hidden",
      }}
    >
      {/* ───────── Header ───────── */}
      <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 }}>
        <h3
          style={{
            margin: 0,
            fontFamily: fontStacks.display,
            // Fraunces variable opsz — push optical sizing high for hero drama.
            fontVariationSettings: '"opsz" 96, "SOFT" 50',
            fontWeight: 500,
            fontSize: 26,
            letterSpacing: "-0.01em",
            color: colors.text,
          }}
        >
          Callsigns held across the long century
        </h3>
        <div
          aria-hidden
          style={{
            fontFamily: fontStacks.mono,
            color: colors.text_dim,
            fontSize: 11,
            letterSpacing: "0.18em",
            opacity: 0.6,
          }}
        >
          {motifs.morseDividers.pattern}
        </div>
        <div
          style={{
            fontFamily: fontStacks.body,
            color: colors.text_dim,
            fontSize: 13,
            maxWidth: 560,
          }}
        >
          Each band traces one callsign from its first appearance to its last
          across the printed callbooks of {yMin}–{yMax}. Hover any band for
          appearance counts.
        </div>
      </div>

      {/* ───────── SVG Chart ───────── */}
      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${innerWidth} ${chartHeight}`}
          width="100%"
          height={chartHeight}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Timeline of ${rows.length} callsigns from ${yMin} to ${yMax}`}
          style={{ display: "block" }}
        >
          {/* SVG defs: gradients, filters, patterns */}
          <defs>
            {/* Sodium-vapor band gradient — left-to-right amber wash */}
            <linearGradient id="sv-band" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colors.accent_2} stopOpacity={0.55} />
              <stop offset="50%" stopColor={colors.accent} stopOpacity={0.72} />
              <stop offset="100%" stopColor={colors.accent_2} stopOpacity={0.55} />
            </linearGradient>
            <linearGradient id="sv-band-hot" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colors.accent_2} stopOpacity={0.95} />
              <stop offset="50%" stopColor={colors.accent} stopOpacity={1} />
              <stop offset="100%" stopColor={colors.accent_2} stopOpacity={0.95} />
            </linearGradient>

            {/* CRT scanlines — horizontal striping at the motif's spacing */}
            <pattern
              id="sv-scanlines"
              width={4}
              height={motifs.scanlines.spacingPx}
              patternUnits="userSpaceOnUse"
            >
              <rect
                width={4}
                height={1}
                fill={colors.text}
                opacity={motifs.scanlines.opacity}
              />
            </pattern>

            {/* Grain noise via SVG turbulence */}
            <filter id="sv-grain" x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency={motifs.grain.baseFrequency}
                numOctaves={2}
                stitchTiles="stitch"
              />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 1
                        0 0 0 0 0.64
                        0 0 0 0 0.04
                        0 0 0 0.5 0"
              />
            </filter>

            {/* Glow filter for the active band */}
            <filter id="sv-glow" x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Soft band shadow — sits the band on the dark surface */}
            <filter id="sv-bandshadow" x="-5%" y="-50%" width="110%" height="200%">
              <feDropShadow
                dx="0"
                dy="1"
                stdDeviation="2.5"
                floodColor={colors.accent}
                floodOpacity="0.25"
              />
            </filter>
          </defs>

          {/* Plot-area background — subtle surface block under the rows */}
          <rect
            x={LEFT_GUTTER - 12}
            y={AXIS_TOP_PAD - 8}
            width={innerWidth - LEFT_GUTTER - RIGHT_GUTTER + 24}
            height={totalRows * (ROW_HEIGHT + ROW_GAP) + 16}
            fill={colors.surface}
            opacity={0.55}
            rx={1}
          />

          {/* Faint per-row guide lines */}
          {rows.map((_, i) => {
            const y = AXIS_TOP_PAD + i * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;
            return (
              <line
                key={`guide-${i}`}
                x1={LEFT_GUTTER}
                x2={innerWidth - RIGHT_GUTTER}
                y1={y}
                y2={y}
                stroke={colors.border}
                strokeWidth={0.6}
                strokeDasharray="1 4"
                opacity={0.55}
              />
            );
          })}

          {/* Minor (per-year) ticks — very faint */}
          {minorTicks.map((y) => {
            const x = xForYear(y);
            return (
              <line
                key={`minor-${y}`}
                x1={x}
                x2={x}
                y1={AXIS_TOP_PAD - 4}
                y2={AXIS_TOP_PAD - 1}
                stroke={colors.text_dim}
                strokeWidth={0.5}
                opacity={0.35}
              />
            );
          })}

          {/* Axis baseline — thin amber rule under the chart */}
          <motion.line
            x1={LEFT_GUTTER}
            x2={innerWidth - RIGHT_GUTTER}
            y1={AXIS_TOP_PAD + totalRows * (ROW_HEIGHT + ROW_GAP) + 8}
            y2={AXIS_TOP_PAD + totalRows * (ROW_HEIGHT + ROW_GAP) + 8}
            stroke={colors.accent}
            strokeWidth={1}
            opacity={0.7}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.7 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />

          {/* Decade ticks + labels */}
          {decadeTicks.map((y, i) => {
            const x = xForYear(y);
            const baseY = AXIS_TOP_PAD + totalRows * (ROW_HEIGHT + ROW_GAP) + 8;
            return (
              <motion.g
                key={`decade-${y}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.04, duration: 0.45 }}
              >
                <line
                  x1={x}
                  x2={x}
                  y1={baseY - 2}
                  y2={baseY + 8}
                  stroke={colors.accent}
                  strokeWidth={1}
                  opacity={0.85}
                />
                <text
                  x={x}
                  y={baseY + 24}
                  textAnchor="middle"
                  fontFamily={fontStacks.mono}
                  fontSize={11}
                  fill={colors.text_dim}
                  letterSpacing="0.08em"
                >
                  {y}
                </text>
              </motion.g>
            );
          })}

          {/* Vertical decade gridlines through the plot — very faint */}
          {decadeTicks.map((y) => {
            const x = xForYear(y);
            return (
              <line
                key={`vgrid-${y}`}
                x1={x}
                x2={x}
                y1={AXIS_TOP_PAD - 4}
                y2={AXIS_TOP_PAD + totalRows * (ROW_HEIGHT + ROW_GAP) + 6}
                stroke={colors.border}
                strokeWidth={0.6}
                opacity={0.55}
              />
            );
          })}

          {/* ──────── Callsign rows + bands ──────── */}
          {rows.map((row, i) => {
            const rowY = AXIS_TOP_PAD + i * (ROW_HEIGHT + ROW_GAP);
            const bandY = rowY + (ROW_HEIGHT - BAND_HEIGHT) / 2;
            const clampedFirst = Math.max(yMin, row.first_year);
            const clampedLast = Math.min(yMax, row.last_year);
            const xStart = xForYear(clampedFirst);
            const xEnd = xForYear(clampedLast);
            const rawWidth = xEnd - xStart;
            const bandWidth = Math.max(MIN_BAND_WIDTH, rawWidth);
            const isHot = hoverIdx === i;

            // Left-side callsign label (mono, dim until row is hot).
            const labelX = LEFT_GUTTER - 14;
            const labelY = rowY + ROW_HEIGHT / 2 + 4;

            return (
              <g key={`row-${row.callsign}-${i}`}>
                {/* Y-axis callsign label */}
                <motion.text
                  x={labelX}
                  y={labelY}
                  textAnchor="end"
                  fontFamily={fontStacks.mono}
                  fontSize={12}
                  fill={isHot ? colors.glow : colors.text_dim}
                  letterSpacing="0.04em"
                  initial={{ opacity: 0, x: labelX - 8 }}
                  animate={{ opacity: 1, x: labelX }}
                  transition={{ delay: 0.5 + i * 0.05, duration: 0.4 }}
                  style={{
                    transition: "fill 180ms ease",
                  }}
                >
                  {row.callsign}
                </motion.text>

                {/* Animated band wipe — clipPath would be cleaner but a
                    scaleX transform on the bar is cheaper and avoids
                    SVG ref churn. */}
                <motion.g
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{
                    delay: 0.6 + i * 0.08,
                    duration: 0.7,
                    ease: [0.2, 0.7, 0.2, 1],
                  }}
                  style={{
                    transformOrigin: `${xStart}px ${bandY + BAND_HEIGHT / 2}px`,
                    transformBox: "fill-box" as never,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    setHoverIdx(i);
                    if (containerRef.current) {
                      const rect = containerRef.current.getBoundingClientRect();
                      setHoverPos({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                      });
                    }
                  }}
                  onMouseMove={(e) => {
                    if (containerRef.current) {
                      const rect = containerRef.current.getBoundingClientRect();
                      setHoverPos({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                      });
                    }
                  }}
                  onMouseLeave={() => {
                    setHoverIdx((prev) => (prev === i ? null : prev));
                    setHoverPos(null);
                  }}
                >
                  {/* Outer dim halo when hot — pure SVG glow */}
                  {isHot && (
                    <rect
                      x={xStart - 4}
                      y={bandY - 4}
                      width={bandWidth + 8}
                      height={BAND_HEIGHT + 8}
                      rx={2}
                      fill={colors.accent}
                      opacity={0.18}
                      filter="url(#sv-glow)"
                    />
                  )}

                  {/* Main band fill */}
                  <rect
                    x={xStart}
                    y={bandY}
                    width={bandWidth}
                    height={BAND_HEIGHT}
                    rx={1.5}
                    fill={isHot ? "url(#sv-band-hot)" : "url(#sv-band)"}
                    stroke={isHot ? colors.glow : colors.accent}
                    strokeWidth={isHot ? 1.2 : 0.8}
                    filter="url(#sv-bandshadow)"
                  />

                  {/* Scanline overlay on the band */}
                  <rect
                    x={xStart}
                    y={bandY}
                    width={bandWidth}
                    height={BAND_HEIGHT}
                    rx={1.5}
                    fill="url(#sv-scanlines)"
                    pointerEvents="none"
                  />

                  {/* End-cap tick at first_year and last_year */}
                  <line
                    x1={xStart}
                    x2={xStart}
                    y1={bandY - 6}
                    y2={bandY + BAND_HEIGHT + 6}
                    stroke={colors.glow}
                    strokeWidth={isHot ? 1.4 : 1}
                    opacity={isHot ? 1 : 0.7}
                  />
                  <line
                    x1={xStart + bandWidth}
                    x2={xStart + bandWidth}
                    y1={bandY - 6}
                    y2={bandY + BAND_HEIGHT + 6}
                    stroke={colors.glow}
                    strokeWidth={isHot ? 1.4 : 1}
                    opacity={isHot ? 1 : 0.7}
                  />

                  {/* In-band callsign label (mono, glow) — only when the
                      band is wide enough to host it without clipping. */}
                  {bandWidth >= 70 && (
                    <text
                      x={xStart + bandWidth / 2}
                      y={bandY + BAND_HEIGHT / 2 + 5}
                      textAnchor="middle"
                      fontFamily={fontStacks.mono}
                      fontSize={14}
                      fontWeight={600}
                      fill={colors.bg}
                      letterSpacing="0.08em"
                      style={{
                        // Inline filter for the amber halo around the
                        // callsign — text-shadow doesn't exist in SVG so
                        // we cheat with a paint-order stroke.
                        paintOrder: "stroke",
                      }}
                      stroke={colors.glow}
                      strokeWidth={0.4}
                      strokeOpacity={0.8}
                    >
                      {row.callsign}
                    </text>
                  )}

                  {/* Tiny year endpoints in the band's negative space */}
                  <text
                    x={xStart + 4}
                    y={bandY - 4}
                    textAnchor="start"
                    fontFamily={fontStacks.mono}
                    fontSize={9}
                    fill={colors.text_dim}
                    opacity={isHot ? 0.95 : 0.65}
                  >
                    {row.first_year}
                  </text>
                  <text
                    x={xStart + bandWidth - 4}
                    y={bandY + BAND_HEIGHT + 11}
                    textAnchor="end"
                    fontFamily={fontStacks.mono}
                    fontSize={9}
                    fill={colors.text_dim}
                    opacity={isHot ? 0.95 : 0.65}
                  >
                    {row.last_year}
                  </text>
                </motion.g>
              </g>
            );
          })}

          {/* Grain overlay — last so it sits on top of everything */}
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={chartHeight}
            filter="url(#sv-grain)"
            opacity={motifs.grain.opacity}
            pointerEvents="none"
          />
        </svg>

        {/* ──────── Tooltip layer (HTML, above the SVG) ──────── */}
        <AnimatePresence>
          {hoverIdx !== null && hoverPos && rows[hoverIdx] && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              style={{
                position: "absolute",
                left: Math.min(hoverPos.x + 14, 720),
                top: hoverPos.y - 56,
                pointerEvents: "none",
                background: colors.bg,
                border: `1px solid ${colors.accent}`,
                borderRadius: 1,
                padding: "8px 10px 10px 12px",
                minWidth: 168,
                fontFamily: fontStacks.mono,
                boxShadow: `0 0 0 1px ${colors.bg}, 0 8px 28px rgba(0,0,0,0.55), 0 0 24px ${colors.accent}22`,
                zIndex: 5,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: colors.glow,
                  letterSpacing: "0.08em",
                  fontWeight: 600,
                  textShadow: motifs.glow.textShadow,
                  marginBottom: 4,
                }}
              >
                {rows[hoverIdx].callsign}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: colors.text_dim,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {rows[hoverIdx].first_year} → {rows[hoverIdx].last_year}
                {"  ·  "}
                {rows[hoverIdx].last_year - rows[hoverIdx].first_year + 1}y
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  borderTop: `1px dashed ${colors.border}`,
                  paddingTop: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 22,
                    color: colors.text,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {rows[hoverIdx].appearance_count.toLocaleString()}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: colors.text_dim,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  appearances
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ───────── Footer key ───────── */}
      <div
        style={{
          marginTop: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: fontStacks.mono,
          fontSize: 10,
          letterSpacing: "0.14em",
          color: colors.text_dim,
          textTransform: "uppercase",
        }}
      >
        <span>
          n = {rows.length} {rows.length === 1 ? "callsign" : "callsigns"}
        </span>
        <span aria-hidden style={{ opacity: 0.5 }}>
          {motifs.morseDividers.tight}
        </span>
        <span>axis {yMin}–{yMax}</span>
      </div>
    </div>
  );
}
