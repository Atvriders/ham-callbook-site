import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono, Geist } from "next/font/google";
import Link from "next/link";
import { Radio, Search, Users, BarChart3, Trophy, GitCompare, FileSearch, Database, UserSearch, MapPin, AlertCircle } from "lucide-react";
import ToolsMenu from "@/components/ToolsMenu";
import SearchBar from "@/components/SearchBar";
import "./globals.css";

/* ---------------------------------------------------------------------------
   Font bindings — Sodium Vapor stack. Each font writes a CSS variable that
   globals.css consumes. Fraunces is loaded as variable so we can crank opsz
   on the hero callsign without shipping a second weight.
   --------------------------------------------------------------------------- */

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz", "SOFT", "WONK"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const geist = Geist({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "US Ham Callbook Archive — Sodium Vapor",
    template: "%s — US Ham Callbook Archive",
  },
  description:
    "US amateur radio license records, 1909 to present — 7.4M historic callbook entries fused with weekly-refreshed FCC ULS data. Callsign history, operator lineage, club timelines.",
  applicationName: "US Ham Callbook Archive",
  keywords: [
    "ham radio",
    "amateur radio",
    "callbook",
    "callsign history",
    "FCC ULS",
    "QRZ",
    "license class",
  ],
  authors: [{ name: "ham-callbook-site" }],
  openGraph: {
    title: "US Ham Callbook Archive",
    description:
      "US ham radio license records, 1909 to present — historic callbooks fused with live FCC data.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "US Ham Callbook Archive",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

/* viewport-fit=cover lets the page paint under the iPhone notch/home bar;
   globals.css pads body with env(safe-area-inset-*) to compensate. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/* ---------------------------------------------------------------------------
   Nav + Footer — local to layout so the foundation file is self-contained;
   later milestones can promote them to /components/nav and /components/footer.
   --------------------------------------------------------------------------- */

function Nav() {
  const items = [
    // On <sm screens the labels hide and this Search icon is the mobile
    // fallback for the compact SearchBar (which is hidden below sm).
    { href: "/search", label: "Search", Icon: Search },
    { href: "/browse", label: "Browse", Icon: Radio },
    { href: "/clubs", label: "Clubs", Icon: Users },
    { href: "/stats", label: "Stats", Icon: BarChart3 },
    { href: "/records", label: "Records", Icon: Trophy },
    { href: "/changes", label: "Changes", Icon: GitCompare },
    { href: "/qsl-dating", label: "QSL", Icon: FileSearch },
    { href: "/data", label: "Data", Icon: Database },
    { href: "/people", label: "People", Icon: UserSearch },
    { href: "/address", label: "Address", Icon: MapPin },
    { href: "/restore", label: "Restore", Icon: AlertCircle },
  ];
  return (
    <header className="site-header border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/85 backdrop-blur-md sticky top-0 z-50">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <Link
          href="/"
          className="group flex items-baseline gap-3 no-underline"
          aria-label="US Ham Callbook Archive — home"
        >
          <span className="twr-dot" aria-hidden />
          <span className="font-display text-lg font-bold tracking-tightest text-[color:var(--color-text)] group-hover:text-[color:var(--color-accent)] transition-colors">
            CALLBOOK<span className="amber-glow-soft text-[color:var(--color-accent)]">.</span>ARCHIVE
          </span>
          <span className="eyebrow hidden md:inline">USA · 1925 — Present</span>
        </Link>
        {/* min-w-0 lets the nav shrink inside the justify-between row so the
            icon strip can scroll sideways on narrow screens instead of
            overflowing the page. The Tools dropdown sits OUTSIDE the scroll
            container — a scroll container would clip its absolutely
            positioned menu — so it stays pinned at the right edge. */}
        <nav className="flex min-w-0 items-center gap-1 text-sm">
          {/* Compact corpus search — client component ('use client' in
              components/SearchBar.tsx), fine to mount from this server
              layout. Sits OUTSIDE the nav-scroll overflow container so its
              autocomplete popover never gets clipped; shrink-[2] lets it
              compress before the icon strip does. Hidden below sm, where
              the Search icon link in the strip covers /search instead. */}
          <div className="hidden sm:block w-44 lg:w-56 min-w-[7rem] shrink-[2]">
            <SearchBar compact />
          </div>
          <div className="nav-scroll flex flex-nowrap items-center gap-1 overflow-x-auto">
            {items.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-sm px-3 py-2.5 text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] hover:bg-[color:var(--color-surface)] transition-colors no-underline"
              >
                <Icon size={14} aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </div>
          {/* Tools dropdown — feature pages grouped by kind */}
          <ToolsMenu />
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const externalLinks = [
    { href: "https://www.fcc.gov/uls", label: "FCC ULS" },
    { href: "https://www.arrl.org", label: "ARRL" },
    { href: "https://www.qrz.com", label: "QRZ.com" },
    { href: "https://leehite.org/callbooks/", label: "Callbook scans (leehite.org)" },
  ];
  return (
    <footer className="mt-24 border-t border-[color:var(--color-border)] bg-[color:var(--color-bg)]">
      <div className="mx-auto max-w-7xl px-6 py-10 grid gap-8 md:grid-cols-3 text-sm text-[color:var(--color-text-dim)]">
        <div>
          <div className="eyebrow mb-2">Transmission</div>
          <p className="leading-relaxed">
            Open archive of US amateur radio callbooks — OCR'd, FCC ULS
            anchored, cross-referenced across editions. Built for operators,
            historians, and the merely curious.
          </p>
        </div>
        <div>
          <div className="eyebrow mb-2">Frequency</div>
          {/* inline-block py-2 → ≥40px tap targets on touch devices */}
          <ul className="space-y-1">
            <li>
              <Link href="/search" className="inline-block py-2.5">Search the archive</Link>
            </li>
            <li>
              <Link href="/browse" className="inline-block py-2.5">Browse editions</Link>
            </li>
            <li>
              <Link href="/stats" className="inline-block py-2.5">Statistics</Link>
            </li>
            <li>
              <Link href="/about" className="inline-block py-2.5">About the data</Link>
            </li>
            {externalLinks.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block py-2.5"
                >
                  {label}
                  <span
                    aria-hidden
                    className="ml-[0.35em] font-mono text-[0.85em] text-[color:var(--color-accent-2)]"
                  >
                    ↗
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-2">Provenance</div>
          <p className="leading-relaxed">
            Source rows graded A (FCC ULS) → D (low-confidence OCR). All
            historical records remain attributed to their original publisher.
          </p>
        </div>
      </div>
      <div className="morse-divider" aria-hidden />
      <div className="mx-auto max-w-7xl px-6 pb-8 text-xs eyebrow flex justify-between">
        <span>· — · · — · ·</span>
        <span>QRT · 73</span>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------------------
   Root layout. Binds the three font variables onto <html> so every nested
   `var(--font-*)` reference resolves to the Google-served webfont.
   --------------------------------------------------------------------------- */

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${jetbrains.variable} ${geist.variable}`}
    >
      <body className="bg-[color:var(--color-bg)] text-[color:var(--color-text)] font-body antialiased min-h-dvh flex flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
