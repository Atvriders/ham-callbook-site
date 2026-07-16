"use client";

/**
 * SearchBar — the corpus search input with autocomplete.
 *
 * Two render modes are supported via the `compact` prop:
 *
 *   * `compact={false}` (default) — the big landing-hero search. Wider,
 *     larger Fraunces label-feeling input, dramatic amber focus glow.
 *   * `compact={true}`           — the slim variant used inside <Nav>.
 *     Single-row, smaller, no helper text.
 *
 * Behaviour:
 *
 *   * Suggestions are fetched from `/api/suggest?q={q}&limit=8`, debounced
 *     200ms after the last keystroke. The endpoint returns a JSON array of
 *     suggestion objects; we tolerate either `{value,label,kind}` shapes
 *     or bare strings. Clubs fan out via `/api/clubs/search?q=…&limit=3`
 *     in parallel and lead the popover.
 *   * Up / Down arrow keys move the active suggestion index; Enter submits
 *     either the highlighted suggestion or the raw query when none is
 *     active. Escape closes the popover and clears focus.
 *   * The forward-slash `/` key acts as a global focus hotkey (à la
 *     GitHub) — unless the user is already typing in a form field.
 *   * On submit we navigate to `/search?q={...}` so the results page can
 *     own its own URL state. If the highlighted suggestion is a direct
 *     callsign match we shortcut to `/callsign/{cs}`.
 *
 * Sodium aesthetic:
 *
 *   * Focus state lights the entire input with a layered sodium-amber
 *     halo (box-shadow, not ring) and warms the border to accent.
 *   * The suggestions dropdown is styled as a **tuner readout** — a
 *     mono frequency-ticks rail down the left edge, kind pills in mono,
 *     and a small "TUNED" marker on the active row.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { colors, fontStacks, motifs } from "../lib/design";

// ---------------------------------------------------------------------------
// Types — the suggest endpoint is intentionally permissive at this stage.
// ---------------------------------------------------------------------------

/**
 * One suggestion row as rendered in the popover. `kind` picks a mono
 * pill label ("CALL", "OP", "QTH", "CLUB"); `value` is what we
 * navigate to on accept; `label` is the human-readable text.
 */
interface Suggestion {
  value: string;
  label: string;
  kind: "callsign" | "name" | "city" | "club" | "other";
}

/**
 * Normalize the raw `/api/suggest` payload into our internal shape.
 */
function normalizeSuggestions(raw: unknown): Suggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row): Suggestion | null => {
      if (typeof row === "string") {
        return { value: row, label: row, kind: "callsign" };
      }
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        const value = typeof r.value === "string" ? r.value : null;
        const label =
          typeof r.label === "string"
            ? r.label
            : typeof r.value === "string"
              ? r.value
              : null;
        const kindRaw = typeof r.kind === "string" ? r.kind : "other";
        const kind =
          kindRaw === "callsign" ||
          kindRaw === "name" ||
          kindRaw === "city" ||
          kindRaw === "club" ||
          kindRaw === "other"
            ? kindRaw
            : "other";
        if (!value || !label) return null;
        return { value, label, kind };
      }
      return null;
    })
    .filter((row): row is Suggestion => row !== null);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SearchBarProps {
  /** Use the slim variant suited to the header. */
  compact?: boolean;
  /** Optional initial value (e.g. when rendered on a results page). */
  initialQuery?: string;
  /**
   * Optional placeholder override. Defaults per mode — the compact one
   * is short, the big one pitches the feature.
   */
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SearchBar({
  compact = false,
  initialQuery = "",
  placeholder,
}: SearchBarProps) {
  const router = useRouter();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const [query, setQuery] = useState<string>(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [open, setOpen] = useState<boolean>(false);
  const [focused, setFocused] = useState<boolean>(false);

  const effectivePlaceholder = useMemo(() => {
    if (placeholder) return placeholder;
    return compact
      ? "search…"
      : "W1AW  ·  Hiram Percy Maxim  ·  Newington, CT";
  }, [compact, placeholder]);

  // -----------------------------------------------------------------------
  // Debounced /api/suggest fetch — fans out to /api/clubs/search in
  // parallel so club station hits surface alongside callsign / name /
  // city suggestions. Club picks land at the top of the popover (capped
  // at 3) and route to /club/{slug} when accepted.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const [suggestRes, clubsRes] = await Promise.all([
          fetch(`/api/suggest?q=${encodeURIComponent(q)}&limit=8`, {
            signal: controller.signal,
          }).catch(() => null),
          fetch(`/api/clubs/search?q=${encodeURIComponent(q)}&limit=3`, {
            signal: controller.signal,
          }).catch(() => null),
        ]);

        let suggestList: Suggestion[] = [];
        if (suggestRes && suggestRes.ok) {
          const data: unknown = await suggestRes.json();
          suggestList = normalizeSuggestions(data);
        }

        let clubList: Suggestion[] = [];
        if (clubsRes && clubsRes.ok) {
          const data: unknown = await clubsRes.json();
          if (Array.isArray(data)) {
            clubList = data
              .map((row): Suggestion | null => {
                if (!row || typeof row !== "object") return null;
                const r = row as Record<string, unknown>;
                const slug = typeof r.slug === "string" ? r.slug : null;
                const displayName =
                  typeof r.display_name === "string" ? r.display_name : null;
                if (!slug || !displayName) return null;
                return { value: slug, label: displayName, kind: "club" };
              })
              .filter((row): row is Suggestion => row !== null)
              .slice(0, 3);
          }
        }

        // Clubs lead — they're the rarer, more specific hit.
        const next: Suggestion[] = [...clubList, ...suggestList];
        setSuggestions(next);
        setOpen(next.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setSuggestions([]);
        }
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query]);

  // -----------------------------------------------------------------------
  // Global "/" hotkey to focus the search input.
  // -----------------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "/") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (t?.isContentEditable ?? false);
      if (isEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // -----------------------------------------------------------------------
  // Submit / accept-suggestion routing.
  // -----------------------------------------------------------------------

  function commit(target: Suggestion | string): void {
    const value = typeof target === "string" ? target : target.value;
    const kind = typeof target === "string" ? "other" : target.kind;
    const trimmed = value.trim();
    if (!trimmed) return;
    setOpen(false);
    setActiveIndex(-1);
    if (kind === "callsign") {
      router.push(`/callsign/${encodeURIComponent(trimmed.toUpperCase())}`);
      return;
    }
    if (kind === "club") {
      router.push(`/club/${encodeURIComponent(trimmed)}`);
      return;
    }
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setActiveIndex(
        (i) => (i - 1 + suggestions.length) % suggestions.length,
      );
      setOpen(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        commit(suggestions[activeIndex]);
      } else {
        commit(query);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  }

  // -----------------------------------------------------------------------
  // Styling — derived once per render. We mix inline style (for the design
  // tokens) with Tailwind utilities (for layout / responsive sizing).
  // -----------------------------------------------------------------------

  const showGlow = focused;
  const heightClass = compact ? "h-9" : "h-14 sm:h-16";
  const fontSize = compact ? "0.875rem" : "1.125rem";

  // Layered halo: a soft outer bloom + a tighter inner glow + the
  // border colour shift. This is the sodium-vapor focus signature.
  const focusHalo = showGlow
    ? `0 0 0 1px ${colors.accent}, 0 0 18px rgba(255, 209, 102, 0.45), 0 0 4px rgba(255, 163, 11, 0.7), inset 0 0 22px rgba(255, 163, 11, 0.08)`
    : "none";

  const inputStyle: React.CSSProperties = {
    backgroundColor: compact ? "rgba(19, 26, 45, 0.7)" : colors.surface,
    color: colors.text,
    fontFamily: fontStacks.mono,
    fontSize,
    letterSpacing: compact ? "0.04em" : "0.06em",
    border: `1px solid ${showGlow ? colors.accent : colors.border}`,
    boxShadow: focusHalo,
    transition:
      "border-color 180ms ease, box-shadow 220ms ease, background-color 180ms ease",
    paddingRight: compact ? "3.25rem" : "5rem",
  };

  return (
    <div className="relative w-full">
      <div className="relative flex items-center">
        {/* Leading dit marker — tiny static mono glyph inside the input,
            like the carrier indicator on a transceiver display. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 select-none"
          style={{
            fontFamily: fontStacks.mono,
            color: showGlow ? colors.accent : colors.text_dim,
            opacity: showGlow ? 1 : 0.55,
            fontSize: compact ? "0.7rem" : "0.85rem",
            letterSpacing: "0.15em",
            textShadow: showGlow ? motifs.glow.textShadow : "none",
            transition: "color 180ms ease, opacity 180ms ease",
          }}
        >
          ·—
        </span>

        {/* Trailing "press /" hotkey pill (only on the big variant) */}
        {!compact ? (
          <span
            aria-hidden
            className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 select-none items-center gap-1 rounded border px-2 py-0.5 text-xs sm:flex"
            style={{
              fontFamily: fontStacks.mono,
              color: colors.text_dim,
              borderColor: colors.border,
              backgroundColor: "rgba(10, 14, 26, 0.6)",
              opacity: 0.85,
              letterSpacing: "0.08em",
            }}
          >
            <span style={{ color: colors.accent_2 }}>press</span>
            <kbd
              style={{
                color: colors.accent,
                fontFamily: fontStacks.mono,
                border: `1px solid ${colors.border}`,
                borderRadius: 3,
                padding: "0 5px",
                fontSize: "0.7rem",
                lineHeight: 1.4,
                background: colors.bg,
              }}
            >
              /
            </kbd>
          </span>
        ) : (
          // Compact mode: spell the hotkey out — a bare "/" pill read as noise.
          // Hidden once the input has focus or text so it never overlaps typing.
          <span
            aria-hidden
            className={`pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none whitespace-nowrap rounded border px-1.5 py-0 text-[10px] ${focused || query ? "md:hidden" : "md:block"}`}
            style={{
              fontFamily: fontStacks.mono,
              color: colors.text_dim,
              borderColor: colors.border,
              backgroundColor: colors.bg,
              opacity: 0.75,
              letterSpacing: "0.05em",
            }}
          >
            press <b style={{ color: colors.accent, fontWeight: 600 }}>/</b> to search
          </span>
        )}

        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
          }
          placeholder={effectivePlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            setFocused(true);
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => {
            setFocused(false);
            // Delay so click on a suggestion can fire before we close.
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          className={`${heightClass} w-full rounded-md outline-none placeholder:opacity-60`}
          style={{
            ...inputStyle,
            paddingLeft: compact ? "2rem" : "2.5rem",
            // keep typed/placeholder text clear of the hotkey hint pill
            paddingRight: compact && !focused && !query ? "7.5rem" : compact ? "0.75rem" : undefined,
          }}
        />
      </div>

      {/* Suggestions popover — the "tuner readout" */}
      {open && suggestions.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1.5 max-h-80 overflow-auto rounded-md py-1 shadow-2xl"
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            boxShadow: `0 18px 50px -16px ${colors.bg}, 0 0 0 1px ${colors.border}, 0 0 24px rgba(255, 163, 11, 0.10)`,
            // Subtle scanline texture on the popover background — sells
            // the tuner-readout vibe without being distracting.
            backgroundImage: `repeating-linear-gradient(
              to bottom,
              rgba(255, 163, 11, 0.02) 0px,
              rgba(255, 163, 11, 0.02) 1px,
              transparent 1px,
              transparent 3px
            )`,
          }}
        >
          {/* Top label — "TUNING" header band */}
          <li
            aria-hidden
            className="flex items-center justify-between px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-[0.28em]"
            style={{
              fontFamily: fontStacks.mono,
              color: colors.accent_2,
              borderBottom: `1px dashed ${colors.border}`,
            }}
          >
            <span>Tuning</span>
            <span>
              {suggestions.length.toString().padStart(2, "0")}&nbsp;hits
            </span>
          </li>

          {suggestions.map((s, i) => {
            const active = i === activeIndex;
            // Frequency-style index marker, e.g. "01·", "02·"
            const freq = (i + 1).toString().padStart(2, "0");
            return (
              <li
                key={`${s.kind}:${s.value}:${i}`}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // mousedown (not click) so we fire before blur closes us
                  e.preventDefault();
                  commit(s);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className="relative flex cursor-pointer items-center gap-3 px-3 py-2"
                style={{
                  backgroundColor: active
                    ? "rgba(255, 163, 11, 0.10)"
                    : "transparent",
                  borderLeft: `2px solid ${active ? colors.accent : "transparent"}`,
                  boxShadow: active
                    ? `inset 0 0 30px rgba(255, 163, 11, 0.06)`
                    : "none",
                  transition: "background-color 120ms ease",
                }}
              >
                {/* Frequency tick on the left rail */}
                <span
                  aria-hidden
                  className="select-none text-[10px]"
                  style={{
                    fontFamily: fontStacks.mono,
                    color: active ? colors.accent : colors.text_dim,
                    opacity: active ? 1 : 0.55,
                    letterSpacing: "0.05em",
                    width: "1.5rem",
                  }}
                >
                  {freq}
                </span>

                {/* Kind pill */}
                <span
                  className="inline-flex w-12 justify-center rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest"
                  style={{
                    fontFamily: fontStacks.mono,
                    color: active ? colors.accent : colors.accent_2,
                    border: `1px solid ${active ? colors.accent : colors.border}`,
                    backgroundColor: colors.bg,
                    textShadow: active ? motifs.glow.textShadow : "none",
                    transition: "color 120ms ease, border-color 120ms ease",
                  }}
                >
                  {kindLabel(s.kind)}
                </span>

                {/* Label — callsigns get the amber glow on the active row */}
                <span
                  className="flex-1 truncate"
                  style={{
                    fontFamily:
                      s.kind === "callsign"
                        ? fontStacks.mono
                        : fontStacks.body,
                    color: colors.text,
                    fontSize: s.kind === "callsign" ? "0.95rem" : "0.9rem",
                    letterSpacing: s.kind === "callsign" ? "0.06em" : "0",
                    textShadow:
                      active && s.kind === "callsign"
                        ? motifs.glow.textShadow
                        : "none",
                  }}
                >
                  {s.label}
                </span>

                {/* TUNED marker on the active row */}
                {active ? (
                  <span
                    aria-hidden
                    className="select-none text-[9px] uppercase tracking-[0.3em]"
                    style={{
                      fontFamily: fontStacks.mono,
                      color: colors.accent,
                      textShadow: motifs.glow.textShadow,
                    }}
                  >
                    ◂ tuned
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Pill text for each suggestion kind. Kept terse so the pill stays narrow.
 */
function kindLabel(kind: Suggestion["kind"]): string {
  switch (kind) {
    case "callsign":
      return "CALL";
    case "name":
      return "OP";
    case "city":
      return "QTH";
    case "club":
      return "CLUB";
    default:
      return "···";
  }
}
