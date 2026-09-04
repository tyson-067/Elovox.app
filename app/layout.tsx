import type { Metadata, Viewport } from "next";
import { Montserrat, Jost, Geist_Mono, Playfair_Display } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { SiteNav } from "@/components/SiteNav";
import { SubNav } from "@/components/SubNav";
import { Footer } from "@/components/Footer";
import { NativeShell } from "@/components/NativeShell";
import { NativeRuntime } from "@/components/NativeRuntime";
import { SiteBackdrop } from "@/components/SiteBackdrop";
import { SiteBanner } from "@/components/SiteBanner";
import { MOTION_ALWAYS_ON } from "@/lib/motion";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
// After globals on purpose: the native theme re-points the web's semantic
// tokens under html[data-native], and later-sheet order is what lets it win
// ties without escalating specificity. The website never matches its rules.
import "./native-theme.css";

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
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Elovox: speak with impact" }],
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
  // #ffffff, not the old #f4f7fc. The light value was a leftover from when
  // the page ground was a pale Vista wash; that wash was deliberately retired
  // (see the note on `body` in globals.css — the ground is the thing the shop
  // sells, so the default has to be the plainest state there is). The browser
  // chrome kept painting the old colour, so on iOS Safari the address bar sat
  // a visibly different shade from the page under it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0a20" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      // The site's motion plays regardless of the OS "reduce motion" setting.
      // Rendered on the server, not stamped by script, because the decision
      // does not depend on the client — see lib/motion.ts for the policy and,
      // importantly, for the half of the accommodation that is KEPT: the
      // rules that bring <Reveal>/<WordReveal> content to opacity 1 are not
      // guarded by this attribute, so nothing can end up invisible.
      data-motion={MOTION_ALWAYS_ON ? "always" : undefined}
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
              // Light by default — the user's call, reversing the booth
              // default after living with it: the app should open the way
              // the brand looks in daylight, and the booth stays one toggle
              // away in Account. A saved choice always wins.
              "if(t!=='light'&&t!=='dark'){t='light'}" +
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
                  "localStorage.getItem('elovox.theme')||'light')};st();" +
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
          {/* The purchased site backdrop (web only), first inside the
              provider because it reads useAuth, and at z-[-1] so it sits
              under every surface that follows. Renders nothing signed out,
              on the default plain look, or inside the native shell. */}
          <SiteBackdrop />
          {/* The website's header. `native-hide` because a logo, a row of
              text links, and a horizontally-scrolling tab strip is browser
              chrome — inside the app, NativeShell puts a title bar and a dock
              in its place. */}
          {/* Operator announcement bar (/admin → Ops). Renders nothing unless
              a banner is set; web only — the native shell has its own chrome
              and never shows it. */}
          <div className="native-hide">
            <SiteBanner />
          </div>
          {/* The site header: a floating glass pill that carries the brand,
              the product sections and the account cluster, with the mobile
              menu it opens. It is fixed, so it renders its own spacer. */}
          <SiteNav />
          {/* The app's per-feature tabs, below the pill and only inside the
              app — marketing and auth screens render nothing here. */}
          <SubNav />
          <NativeShell />
          {/* Renders nothing — it owns the native side effects (splash, status
              bar, keyboard, haptics, edge-swipe back). Its effects reach for
              #main and the title bar's back button, both of which exist by
              then: effects run after the whole tree has committed, so source
              order here is only about reading in the order things happen. */}
          <NativeRuntime />
          {/* max-w + mx-auto: <main> used to be full-bleed at every width, so on
              anything past ~1600px the hero grid, every card grid and the story
              deck simply kept stretching and the site read as a browser window
              rather than a page. --container-page caps it; the gutters below stay
              because they are what does the work on phones. The cap is deliberately
              on #main and not on an inner wrapper, so a section that WANTS to go
              full-bleed opts out with its own negative margin rather than every
              other section opting in. */}
          <main
            id="main"
            className="flex-1 w-full mx-auto max-w-[var(--container-page)] px-4 md:px-10 xl:px-16 2xl:px-24"
          >
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
