import type { Metadata, Viewport } from "next";
import { Montserrat, Jost, Geist_Mono, Playfair_Display } from "next/font/google";
import Link from "next/link";
import Image from "next/image";
import { AuthProvider } from "@/components/AuthProvider";
import { AuthNav } from "@/components/AuthNav";
import { SubNav } from "@/components/SubNav";
import { ScrollProgress } from "@/components/ScrollProgress";
import { Footer } from "@/components/Footer";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// Brand type direction: geometric/deco sans (Amenti, Konnect, Fonseca).
// Those are paid faces without web-embed licenses, so we ship their
// closest Google equivalents, Montserrat (deco-inspired, for headlines)
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
// ("impact."), the calligraphic Didone counterpoint to the geometric sans.
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  weight: ["500", "600"],
  style: ["italic"],
});

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://elovox.app";

// Colon, not a comma: this is a brand plus a tagline, and it is the string
// search results and the browser tab show. (It was an em dash before the
// copy sweep; a comma made it read as a list.)
const TITLE = "Elovox: Speak with Impact";
// Leads with the product name: this string is what link previews and
// automated reviewers quote back, and Google's OAuth review flagged the site
// for not naming the app clearly.
const DESCRIPTION =
  "Elovox is a speaking practice app. Practice speeches, pitches, and interviews out loud, and get specific coaching on your delivery.";

export const metadata: Metadata = {
  // Absolute base for canonical/OG URLs. Preview deploys can override it
  // with NEXT_PUBLIC_APP_URL so their links don't point at production.
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Elovox",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/logo.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f7fc",
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
          <header className="sticky top-0 z-40 border-b border-primary/8 bg-surface/80 backdrop-blur-md">
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
                {/* Hidden under 360px, where the wordmark is the difference
                    between a header that fits and one that wraps: at 320px
                    the bar has 288px of content width and the logo plus the
                    three nav items need 333px. The fox mark still carries the
                    brand and the link keeps its aria-label, so nothing is lost
                    to a screen reader. 360px, not the `sm` breakpoint, because
                    every common phone from the iPhone SE 2 (375) up has room
                    for the wordmark and should keep it. */}
                <span className="font-headline text-xl font-bold tracking-tight transition-opacity group-hover:opacity-80 max-[359px]:hidden">
                  Elovox
                </span>
              </Link>
              {/* gap-3 below `sm`: 20px between items is comfortable on a
                  desktop header and is 16px of pure overflow on a narrow
                  phone. Helps the signed-in header too, which carries its own
                  set (Practice, the account chip, Sign out, and Pricing while
                  the plan is free). */}
              <nav className="flex items-center gap-3 sm:gap-5 text-[13px] font-semibold tracking-wide text-primary/70">
                <AuthNav />
              </nav>
            </div>
            <SubNav />
            <ScrollProgress />
          </header>
          <main id="main" className="flex-1 w-full px-4 md:px-10 xl:px-16 2xl:px-24">
            {children}
          </main>
          <Footer />
          {/* Cookieless traffic analytics, pageviews, referrers, countries,
              devices. Sets no cookies and stores no cross-site identifier, so
              it needs no consent banner and nothing changes in the privacy
              policy's cookie stance. Served same-origin from /_vercel/insights,
              which the CSP's 'self' already allows. */}
          <Analytics />
        </AuthProvider>
      </body>
    </html>
  );
}
