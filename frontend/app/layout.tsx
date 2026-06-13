import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Geist } from "next/font/google";
import Link from "next/link";
import { Radio, Search, BookOpen, Users, BarChart3, Trophy, GitCompare, FileSearch, Database, UserSearch, MapPin, AlertCircle } from "lucide-react";
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
    icon: "/favicon.ico",
  },
};

/* ---------------------------------------------------------------------------
   Nav + Footer — local to layout so the foundation file is self-contained;
   later milestones can promote them to /components/nav and /components/footer.
   --------------------------------------------------------------------------- */

function Nav() {
  const items = [
    { href: "/search", label: "Search", Icon: Search },
    { href: "/calls", label: "Callsigns", Icon: Radio },
    { href: "/editions", label: "Editions", Icon: BookOpen },
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
    <header className="border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/85 backdrop-blur-md sticky top-0 z-50">
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
        <nav className="flex items-center gap-1 text-sm">
          {items.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-sm px-3 py-2 text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] hover:bg-[color:var(--color-surface)] transition-colors no-underline"
            >
              <Icon size={14} aria-hidden />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
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
          <ul className="space-y-1">
            <li>
              <Link href="/search">Search the archive</Link>
            </li>
            <li>
              <Link href="/editions">Browse editions</Link>
            </li>
            <li>
              <Link href="/stats">Statistics</Link>
            </li>
            <li>
              <Link href="/about">About the data</Link>
            </li>
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
