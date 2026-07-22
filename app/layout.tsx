import type { Metadata, Viewport } from "next";
import { Montserrat, Jost, Geist_Mono, Playfair_Display } from "next/font/google";
import Link from "next/link";
import Image from "next/image";
import { AuthProvider } from "@/components/AuthProvider";
import { AuthNav } from "@/components/AuthNav";
import { SubNav } from "@/components/SubNav";
import { ScrollProgress } from "@/components/ScrollProgress";
import "./globals.css";

// Brand type direction: geometric/deco sans (Amenti, Konnect, Fonseca).
// Those are paid faces without web-embed licenses, so we ship their
// closest Google equivalents — Montserrat (deco-inspired, for headlines)
// and Jost (geometric, for body/UI). If the real fonts are licensed
// later, swap them in via next/font/local and update globals.css.
// Geist Mono stays for numbers, scores, and timestamps.
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  weight: ["500", "600", "700", "800"],
});

const jost = Jost({
  subsets: ["latin"],
  variable: "--font-jost",
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  weight: ["500"],
});

// Elegant high-contrast serif, italic only, for the display slogan
// ("impact.") — the calligraphic Didone counterpoint to the geometric sans.
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  weight: ["500", "600"],
  style: ["italic"],
});

export const metadata: Metadata = {
  title: "Elovox — Speak with Impact",
  description:
    "Speak with impact. Practice speeches, pitches, and interviews with Elovox and get specific coaching on your delivery.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${jost.variable} ${geistMono.variable} ${playfair.variable}`}
    >
      <body className="min-h-dvh flex flex-col">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <AuthProvider>
          <header className="sticky top-0 z-40 border-b border-primary/8 bg-white/85 backdrop-blur-md">
            <div className="w-full px-4 md:px-10 xl:px-16 2xl:px-24 h-14 flex items-center justify-between">
              <Link
                href="/"
                className="group flex items-center gap-2.5 text-primary"
                aria-label="Elovox home"
              >
                {/* unoptimized: a 36px static asset gains nothing from the
                    /_next/image optimizer, and serving it directly avoids
                    the optimizer's cache going stale across dev restarts */}
                <Image
                  src="/logo.png"
                  alt=""
                  width={36}
                  height={36}
                  unoptimized
                  className="h-9 w-9 rounded-[10px] transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-rotate-6"
                  priority
                />
                <span className="font-headline text-xl font-bold tracking-tight transition-opacity group-hover:opacity-80">
                  Elovox
                </span>
              </Link>
              <nav className="flex items-center gap-5 text-[13px] font-semibold tracking-wide text-primary/70">
                <AuthNav />
              </nav>
            </div>
            <SubNav />
            <ScrollProgress />
          </header>
          <main id="main" className="flex-1 w-full px-4 md:px-10 xl:px-16 2xl:px-24">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
