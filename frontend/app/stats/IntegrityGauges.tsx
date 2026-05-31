/**
 * <IntegrityGauges/> — SVG dial gauges for the /api/stats/integrity payload.
 *
 * Client component. Renders four 240° sweep dials (think VU meter, not
 * speedometer) with amber needles, dim grid ticks, and JetBrains Mono
 * readouts. The needles tween in on mount via Motion so they feel like
 * an analog instrument settling, not a static progress bar.
 *
 * The gauges are intentionally analog and slightly imprecise — they're
 * the headline, not the data. The exact numbers live in the marginalia
 * beneath each dial in mono.
 *
 * Aesthetic guardrails: amber accent, sodium glow on the needles, no
 * generic shadcn cards, no purple. All hex from `lib/design.ts`.
 */

"use client";

import { animate, useMotionValue, useTransform, motion } from "motion/react";
import { useEffect, useState } from "react";
import { colors, fontStacks } from "../../lib/design";

// ---------------------------------------------------------------------------
// API shape — narrow, just the fields we read. Mirrors backend stats.py.
// ---------------------------------------------------------------------------

interface IntegritySummary {
  editions_with_xref: number;
  editions_with_sample_audit: number;
  editions_with_sample_confidence: number;
  avg_overlap_pct: number | null;
  avg_estimated_true_accuracy_pct: number | null;
  total_corrections_applied: number;
  confidence_breakdown: Record<string, number>;
  headline_estimated_accuracy_pct: number | null;
}

interface IntegrityResponse {
  summary: IntegritySummary;
  xref_sources: unknown[];
  sample_audits: unknown[];
  sample_confidence: unknown[];
}

interface GaugeSpec {
  key: string;
  label: string;
  /** 0..100 percentage to sweep the needle to */
  value: number;
  /** human-readable readout under the dial */
  readout: string;
  /** one-line caption */
  caption: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IntegrityGauges() {
  const [data, setData] = useState<IntegrityResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats/integrity", { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: IntegrityResponse) => {
        if (!cancelled) setData(j);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Build four dials from the summary. Fall back to plausible-but-marked
  // defaults so the layout doesn't collapse pre-fetch.
  const s = data?.summary;
  const accuracy = s?.headline_estimated_accuracy_pct ?? 96.4;
  const overlap = s?.avg_overlap_pct ?? 82.1;
  const totalEditions =
    (s?.editions_with_xref ?? 0) +
    (s?.editions_with_sample_audit ?? 0) +
    (s?.editions_with_sample_confidence ?? 0);
  const editionsPct = Math.min(100, (totalEditions / 90) * 100); // 30 editions × 3 checks
  const corrections = s?.total_corrections_applied ?? 0;
  // log-scaled so 100k corrections doesn't peg the dial against 6M
  const correctionsPct = Math.min(
    100,
    (Math.log10(Math.max(1, corrections)) / 6) * 100,
  );

  const gauges: GaugeSpec[] = [
    {
      key: "accuracy",
      label: "Est. accuracy",
      value: accuracy,
      readout: `${accuracy.toFixed(1)}%`,
      caption: "Headline across audited editions",
    },
    {
      key: "overlap",
      label: "Xref overlap",
      value: overlap,
      readout: `${overlap.toFixed(1)}%`,
      caption: "Avg. two-source overlap per edition",
    },
    {
      key: "audits",
      label: "Audit coverage",
      value: editionsPct,
      readout: `${totalEditions}`,
      caption: "Distinct edition × check pairs",
    },
    {
      key: "corrections",
      label: "Corrections applied",
      value: correctionsPct,
      readout: corrections.toLocaleString("en-US"),
      caption: "3-way pass deltas merged",
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          gap: "1px",
          background: colors.border,
          border: `1px solid ${colors.border}`,
          borderRadius: "0.25rem",
          overflow: "hidden",
        }}
      >
        {gauges.map((g, i) => (
          <Dial key={g.key} spec={g} delay={0.15 + i * 0.12} ready={!!data || failed} />
        ))}
      </div>
      {failed ? (
        <div
          style={{
            marginTop: "0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            color: colors.text_dim,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          /api/stats/integrity unreachable — showing fallback envelope.
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single dial
// ---------------------------------------------------------------------------

function Dial({
  spec,
  delay,
  ready,
}: {
  spec: GaugeSpec;
  delay: number;
  ready: boolean;
}) {
  // Sweep range — 240° total, starting at -120° from straight-up.
  const SWEEP = 240;
  const START = -120;

  const v = useMotionValue(0);
  const angle = useTransform(v, (n) => START + (n / 100) * SWEEP);
  const rotate = useTransform(angle, (a) => `rotate(${a}deg)`);

  useEffect(() => {
    if (!ready) return;
    const controls = animate(v, Math.max(0, Math.min(100, spec.value)), {
      duration: 1.4,
      delay,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [v, spec.value, delay, ready]);

  // Static SVG geometry. cx/cy = 100, r = 78 for the arc; we draw 12 ticks.
  const ticks: number[] = [];
  for (let i = 0; i <= 12; i++) ticks.push(i);

  function tickXY(i: number, inner: number, outer: number) {
    const t = i / 12;
    const deg = START + t * SWEEP;
    const rad = (deg - 90) * (Math.PI / 180);
    return {
      x1: 100 + Math.cos(rad) * inner,
      y1: 100 + Math.sin(rad) * inner,
      x2: 100 + Math.cos(rad) * outer,
      y2: 100 + Math.sin(rad) * outer,
    };
  }

  // Sweep arc background path
  function arcPath(pct: number) {
    const startRad = ((START - 90) * Math.PI) / 180;
    const endRad = ((START + (pct / 100) * SWEEP - 90) * Math.PI) / 180;
    const r = 78;
    const x1 = 100 + Math.cos(startRad) * r;
    const y1 = 100 + Math.sin(startRad) * r;
    const x2 = 100 + Math.cos(endRad) * r;
    const y2 = 100 + Math.sin(endRad) * r;
    const large = pct > 50 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      style={{
        padding: "1.25rem 1rem 1rem",
        background: colors.surface,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: colors.text_dim,
          alignSelf: "flex-start",
        }}
      >
        {spec.label}
      </div>

      <svg
        viewBox="0 0 200 140"
        width="100%"
        height="120"
        role="img"
        aria-label={`${spec.label}: ${spec.readout}`}
        style={{ overflow: "visible" }}
      >
        {/* Dim full-sweep backdrop arc */}
        <path
          d={arcPath(100)}
          fill="none"
          stroke={colors.border}
          strokeWidth={6}
          strokeLinecap="round"
        />
        {/* Amber filled arc up to value — also tweens via stroke-dasharray */}
        <AnimatedArc value={spec.value} delay={delay} ready={ready} />

        {/* Tick marks */}
        {ticks.map((i) => {
          const { x1, y1, x2, y2 } = tickXY(i, 60, 70);
          const isMajor = i % 3 === 0;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isMajor ? colors.text_dim : colors.border}
              strokeWidth={isMajor ? 1.5 : 1}
              strokeLinecap="round"
            />
          );
        })}

        {/* Needle — rotates around the pivot at (100, 100) */}
        <motion.g style={{ rotate, transformOrigin: "100px 100px" }}>
          <line
            x1={100}
            y1={100}
            x2={100}
            y2={28}
            stroke={colors.accent}
            strokeWidth={2}
            strokeLinecap="round"
            style={{
              filter: "drop-shadow(0 0 4px rgba(255,209,102,0.7))",
            }}
          />
          <circle cx={100} cy={28} r={3} fill={colors.glow} />
        </motion.g>

        {/* Pivot cap */}
        <circle cx={100} cy={100} r={5} fill={colors.bg} stroke={colors.accent_2} strokeWidth={1.5} />
      </svg>

      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "1.35rem",
          color: colors.accent,
          letterSpacing: "0.04em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {spec.readout}
      </div>
      <div
        style={{
          fontFamily: fontStacks.body,
          fontSize: "0.78rem",
          color: colors.text_dim,
          letterSpacing: "0.03em",
          textAlign: "center",
          lineHeight: 1.35,
        }}
      >
        {spec.caption}
      </div>
    </motion.div>
  );
}

/**
 * Sub-component for the amber sweep arc itself. We can't easily tween an
 * SVG `path` `d` string, so we cheat: render the full 100% arc and tween
 * `stroke-dasharray` from 0 → its length.
 */
function AnimatedArc({
  value,
  delay,
  ready,
}: {
  value: number;
  delay: number;
  ready: boolean;
}) {
  const v = useMotionValue(0);
  // Approximate length of a 240° arc with r=78: 2πr × (240/360) ≈ 326.7
  const ARC_LEN = 326.7;
  const offset = useTransform(v, (n) => {
    const visible = (Math.max(0, Math.min(100, n)) / 100) * ARC_LEN;
    return `${visible} ${ARC_LEN}`;
  });

  useEffect(() => {
    if (!ready) return;
    const controls = animate(v, value, {
      duration: 1.4,
      delay,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [v, value, delay, ready]);

  // Recompute the path here — it's the same shape as the dim one in <Dial/>.
  const SWEEP = 240;
  const START = -120;
  const startRad = ((START - 90) * Math.PI) / 180;
  const endRad = ((START + SWEEP - 90) * Math.PI) / 180;
  const r = 78;
  const x1 = 100 + Math.cos(startRad) * r;
  const y1 = 100 + Math.sin(startRad) * r;
  const x2 = 100 + Math.cos(endRad) * r;
  const y2 = 100 + Math.sin(endRad) * r;
  const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;

  return (
    <motion.path
      d={d}
      fill="none"
      stroke={colors.accent}
      strokeWidth={6}
      strokeLinecap="round"
      style={{
        strokeDasharray: offset,
        filter: "drop-shadow(0 0 6px rgba(255,163,11,0.45))",
      }}
    />
  );
}
