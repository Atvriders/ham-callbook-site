"use client";

/* ---------------------------------------------------------------------------
   ToolsMenu — the nav's "Tools" dropdown, extracted from app/layout.tsx so it
   can carry client-side tap support. Desktop hover behavior is unchanged (the
   same group-hover/tools classes drive it); on touch devices the trigger now
   toggles the menu open/closed, and a document-level pointerdown listener
   closes it when tapping anywhere outside.
   --------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Wrench, ChevronDown } from "lucide-react";

/**
 * Menu contents, grouped: Wave-4 analysis tools, then archive/research
 * pages, then utility pages. Groups render with a subtle top border so
 * the (now long) list stays scannable.
 */
const toolGroups: { href: string; label: string }[][] = [
  [
    { href: "/nearby", label: "Hams near me" },
    { href: "/adif", label: "ADIF Time Machine" },
    { href: "/cohorts", label: "Cohort Observatory" },
    { href: "/name-voyager", label: "Name Voyager" },
    { href: "/gedcom", label: "GEDCOM Bridge" },
  ],
  [
    { href: "/records", label: "Records" },
    { href: "/people", label: "People" },
    { href: "/households", label: "Households" },
    { href: "/clubs", label: "Clubs" },
  ],
  [
    { href: "/qsl-dating", label: "QSL dating" },
    { href: "/changes", label: "Changes" },
    { href: "/address", label: "Address time machine" },
    { href: "/restore", label: "Restore queue" },
    { href: "/data", label: "Data" },
    { href: "/random", label: "Random callsign" },
  ],
];

export default function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside tap/click — only wired while the menu is open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        rootRef.current &&
        e.target instanceof Node &&
        !rootRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative group/tools">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-sm px-3 py-2.5 text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] hover:bg-[color:var(--color-surface)] transition-colors"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Tools menu"
      >
        <Wrench size={14} aria-hidden />
        <span className="hidden sm:inline">Tools</span>
        <ChevronDown size={11} aria-hidden className="hidden sm:block opacity-60" />
      </button>
      <div
        className={`absolute right-0 top-full mt-1 w-48 max-h-[70vh] overflow-y-auto border border-[color:var(--color-border)] bg-[color:var(--color-bg)] rounded-sm shadow-lg transition-opacity z-50 ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover/tools:opacity-100 group-hover/tools:pointer-events-auto"
        }`}
        role="menu"
      >
        {toolGroups.map((group, gi) => (
          <div
            key={gi}
            role="group"
            className={
              gi > 0
                ? "border-t border-[color:var(--color-border)]/60 mt-1 pt-1"
                : undefined
            }
          >
            {group.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] hover:bg-[color:var(--color-surface)] no-underline transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
