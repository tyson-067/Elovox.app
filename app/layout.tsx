import type { Metadata, Viewport } from "next";
import { Montserrat, Jost, Geist_Mono, Playfair_Display } from "next/font/google";
import Link from "next/link";
import Image from "next/image";
import { AuthProvider } from "@/components/AuthProvider";
import { AuthNav } from "@/components/AuthNav";
import { SubNav } from "@/components/SubNav";
import { ScrollProgress } from "@/components/ScrollProgress";
import { Footer } from "@/components/Footer";
import { NativeShell } from "@/components/NativeShell";
import { NativeRuntime } from "@/components/NativeRuntime";
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
  // Deliberately NO `alternates` here. Next.js INHERITS alternates rather
  // than merging them, so a canonical set on the root layout was emitted by
  // every route that doesn't override it — /login, /signup, /dashboard,
  // /practice, /progress, /library, /report/*, and the rest all told crawlers
  // they were really the homepage. The homepage sets its own; every other
  // public route already sets its own too.
  openGraph: {
    type: "website",
    siteName: "Elovox",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Elovox — speak with impact" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The native chrome runs under the status bar and the home indicator and
  // insets itself with env(safe-area-inset-*). Without viewport-fit=cover
  // those insets are all 0 and the layout sits in a letterboxed safe box,
  // which is the single most obvious "this is a webview" tell there is.
  viewportFit: "cover",
  // Browsers keep the pale Vista wash. The native app paints its own
  // background behind the status bar, so the dark entry matches the booth.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f7fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0a20" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      // The inline script below stamps data-native and data-theme onto this
      // element before React hydrates, which is the whole point of it — the
      // server cannot know which client is asking. React sees attributes it
      // didn't render and warns; this says the difference is intentional. It
      // suppresses the warning for <html>'s own attributes only, not for the
      // tree inside it.
      suppressHydrationWarning
      className={`${montserrat.variable} ${jost.variable} ${geistMono.variable} ${playfair.variable}`}
    >
      <body className="min-h-dvh flex flex-col">
        {/* Marks the document as running inside the iOS/Android shell, before
            anything paints. Apple requires that the native app never shows a
            price or a route to buying Premium (Guideline 3.1.1), and the
            server can't know which client it is serving — the native app loads
            this very same deployment. So the decision is made here, in the
            document, and `.web-only` in globals.css does the hiding.

            Deliberately NOT a React state/effect: a hook would render the
            upgrade CTA first and remove it a frame later, which is both a
            visible flicker and exactly the thing a reviewer would screenshot.
            Capacitor injects window.Capacitor before body scripts run, so this
            is settled before the header ever paints. */}
        {/* The same script also settles the theme, and for the same reason:
            dark mode is native-only, and a React effect would paint the whole
            app white and correct itself a frame later. A saved choice wins;
            with none, the app follows the phone. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement;" +
              "var stampNative=function(){" +
              "d.setAttribute('data-native','1');" +
              "if(!d.getAttribute('data-theme')){" +
              "var t=null;try{t=localStorage.getItem('elovox.theme')}catch(e){}" +
              "if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}" +
              "d.setAttribute('data-theme',t)}};" +
              "if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){" +
              "stampNative();" +
              // Re-asserted after load because React owns <html> from
              // hydration on, and a hydration RECOVERY — server DOM
              // discarded, tree client-rendered — rebuilds the element's
              // attributes from JSX, which knows nothing of this stamp. That
              // is not a dev-tool corner case: any prod hydration error would
              // silently strip the app back to the website chrome. The
              // attribute is observed (lib/native.ts), so consumers heal.
              "window.addEventListener('load',function(){" +
              "setTimeout(stampNative,0);setTimeout(stampNative,350)})" +
              "}}catch(e){}" +
              // Dev only, and compiled out of production entirely: `?native=1`
              // paints the native UI in a desktop browser so it can be worked
              // on without a rebuild-and-deploy cycle through Xcode. It sticks
              // for the tab so client-side navigation keeps it.
              (process.env.NODE_ENV === "production"
                ? ""
                : "try{var q=location.search.indexOf('native=1')>=0;" +
                  "if(q)sessionStorage.setItem('elovox.devNative','1');" +
                  // `?demo=1`: pretend Firebase is absent so the localStorage
                  // fallback renders the signed-in surface without an account.
                  // Read by isFirebaseConfigured (lib/firebase.ts). Dev only,
                  // same lifetime and mechanism as the native flag above.
                  "if(location.search.indexOf('demo=1')>=0)" +
                  "sessionStorage.setItem('elovox.devDemo','1');" +
                  "if(q||sessionStorage.getItem('elovox.devNative')){" +
                  "var st=function(){var e2=document.documentElement;" +
                  "e2.setAttribute('data-native','1');" +
                  "if(!e2.getAttribute('data-theme'))e2.setAttribute('data-theme'," +
                  "localStorage.getItem('elovox.theme')||'dark')};st();" +
                  // Re-assert after load: demo mode makes the server render
                  // "configured" and the client "unconfigured", so React
                  // discards the server DOM and client-renders, which rebuilds
                  // <html>'s attributes and wipes the stamp. Dev-only, like
                  // everything in this block; useIsNative observes the
                  // attribute, so consumers recover when it returns.
                  "window.addEventListener('load',function(){setTimeout(st,0);setTimeout(st,300)})" +
                  "}}catch(e){}"),
          }}
        />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <AuthProvider>
          {/* The website's header. `native-hide` because a logo, a row of
              text links, and a horizontally-scrolling tab strip is browser
              chrome — inside the app, NativeShell puts a title bar and a dock
              in its place. */}
          <header className="native-hide sticky top-0 z-40 border-b border-primary/8 bg-surface/80 backdrop-blur-md">
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
          <NativeShell />
          {/* Renders nothing — it owns the native side effects (splash, status
              bar, keyboard, haptics, edge-swipe back). Its effects reach for
              #main and the title bar's back button, both of which exist by
              then: effects run after the whole tree has committed, so source
              order here is only about reading in the order things happen. */}
          <NativeRuntime />
          <main id="main" className="flex-1 w-full px-4 md:px-10 xl:px-16 2xl:px-24">
            {children}
          </main>
          {/* No app has a footer. Pricing / Terms / Privacy / About stacked at
              the bottom of a scroll is the most website-shaped thing in the
              product; inside the app those live as rows in Account. */}
          <div className="native-hide">
            <Footer />
          </div>
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
