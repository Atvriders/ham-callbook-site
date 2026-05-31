"use client";

/**
 * Nav — sticky top navigation bar for the ham-callbook site.
 *
 * Anatomy, left to right:
 *
 *   * TWR dot     — animated transmit-receive indicator (1.2s heartbeat),
 *                   shared <TwrIndicator/> component. Signals "we're hot,
 *                   the corpus is loaded".
 *   * Site mark   — Fraunces wordmark "USA HAM CALLBOOKS" with a faint
 *                   sodium-amber glow on the centre word, tracking-wide
 *                   caps. Home link.
 *   * Compact     — slim SearchBar variant. Hidden on mobile.
 *     search
 *   * Section     — Search · Browse · Clubs · Stats · About. Active route
 *     links         gets a sodium underline that animates between links
 *                   via layoutId (a one-of-a-kind detail for this nav).
 *
 * Memorable thing: the bottom hairline is not a static border. It's a
 * faint amber "carrier wave" that intensifies as you scroll — the nav
 * literally tunes itself in as content slides beneath it.
 *
 * sticky (not fixed) so the bar participates in document flow and the
 * scanlines / grain from <Hero/> remain visible through the blur.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

import SearchBar from "./SearchBar";
import TwrIndicator from "./TwrIndicator";
import { colors, fontStacks, motifs } from "../lib/design";

interface NavLink {
  href: string;
  label: string;
}

/**
 * The five-up section IA. Order is deliberate — Search first because
 * it's the primary action, About last because it's the appendix.
 */
const NAV_LINKS: readonly NavLink[] = [
  { href: "/search", label: "Search" },
  { href: "/browse", label: "Browse" },
  { href: "/clubs", label: "Clubs" },
  { href: "/stats", label: "Stats" },
  { href: "/about", label: "About" },
] as const;

/**
 * Decide whether a nav href is "active" for the current pathname.
 *
 * Exact match wins for `/`, prefix match for everything else so that
 * `/search/W1AW` still lights up the Search link.
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  // Intensify the backdrop blur + carrier-wave rule as the user scrolls.
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 4);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="sticky top-0 z-40 w-full"
      style={{
        // Slight translucency + heavier blur once scrolled so the
        // scanlines from the hero are still visible *through* the nav.
        backgroundColor: scrolled
          ? "rgba(10, 14, 26, 0.88)"
          : "rgba(10, 14, 26, 0.62)",
        backdropFilter: scrolled
          ? "saturate(160%) blur(14px)"
          : "saturate(140%) blur(6px)",
        WebkitBackdropFilter: scrolled
          ? "saturate(160%) blur(14px)"
          : "saturate(140%) blur(6px)",
        transition:
          "background-color 240ms ease, backdrop-filter 240ms ease",
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
        {/* Site mark + TWR indicator */}
        <Link
          href="/"
          className="group flex items-center gap-2 outline-none"
          aria-label="USA Ham Callbooks — home"
        >
          <TwrIndicator />
          <span
            className="text-base tracking-[0.22em] sm:text-lg"
            style={{
              fontFamily: fontStacks.display,
              fontVariationSettings: '"opsz" 48, "SOFT" 30',
              color: colors.text,
              fontWeight: 500,
            }}
          >
            USA{" "}
            <span
              className="italic"
              style={{
                color: colors.accent,
                fontVariationSettings: '"opsz" 48, "SOFT" 100, "WONK" 1',
                textShadow: motifs.glow.textShadow,
              }}
            >
              HAM
            </span>{" "}
            CALLBOOKS
          </span>
        </Link>

        {/* Compact search — fills available width on >=md, hidden on mobile */}
        <div className="hidden flex-1 md:block">
          <SearchBar compact />
        </div>

        {/* Section links */}
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className="relative px-3 py-1.5 text-sm transition-colors duration-150"
                style={{
                  fontFamily: fontStacks.body,
                  color: active ? colors.text : colors.text_dim,
                  letterSpacing: "0.06em",
                }}
                aria-current={active ? "page" : undefined}
              >
                {/* The label */}
                <span style={{ position: "relative", zIndex: 1 }}>
                  {link.label}
                </span>
                {/* Active underline — morphs between active links via layoutId.
                    Two stacked layers: a sharp 1px amber rule + a soft glow
                    bar beneath it. */}
                {active ? (
                  <>
                    <motion.span
                      layoutId="nav-underline"
                      aria-hidden
                      className="absolute -bottom-1 left-2 right-2 h-px"
                      style={{
                        backgroundColor: colors.accent,
                        boxShadow: `0 0 8px ${colors.glow}, 0 0 2px ${colors.accent}`,
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 30,
                      }}
                    />
                    <motion.span
                      layoutId="nav-underline-glow"
                      aria-hidden
                      className="absolute -bottom-1.5 left-2 right-2 h-1 rounded-full"
                      style={{
                        background: `radial-gradient(ellipse at center, ${colors.accent}55, transparent 70%)`,
                        opacity: 0.7,
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 30,
                      }}
                    />
                  </>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Memorable detail: amber "carrier wave" hairline rule beneath the
          nav. Opacity rises with scroll, giving the nav a tuned-in feel.
          Two layered rules — a hard 1px border + a wider glowing bar. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-px h-px"
        style={{
          background: scrolled
            ? `linear-gradient(to right, transparent 0%, ${colors.accent} 18%, ${colors.glow} 50%, ${colors.accent} 82%, transparent 100%)`
            : colors.border,
          opacity: scrolled ? 0.55 : 1,
          transition: "opacity 240ms ease, background 240ms ease",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-1 h-1"
        style={{
          background: `linear-gradient(to bottom, ${colors.accent}, transparent)`,
          opacity: scrolled ? 0.18 : 0,
          transition: "opacity 240ms ease",
          filter: "blur(2px)",
        }}
      />
    </header>
  );
}
