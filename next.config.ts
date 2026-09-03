import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Security headers. Vercel serves none of these by default, so without this
// file the app ships with no clickjacking, MIME-sniffing, or content-injection
// protection at all.
//
// The CSP is deliberately allow-listed to the three third parties the browser
// actually talks to — Firebase Auth, Firestore, and Stripe — and nothing else.
// Fonts are self-hosted by next/font at build time, so no font CDN is needed.

const isDev = process.env.NODE_ENV === "development";

// The Terms and Privacy pages render whatever lib/legal.ts holds, placeholders
// included — they were live on /terms reading "[LEGAL ENTITY — …]". Terms that
// name no entity and no governing law are hard to enforce, and it is the kind
// of thing nobody notices until it matters. Shout on every build until the
// real values are in. Deliberately a warning, not a thrown error: breaking the
// deploy of a working app over copy would be worse than the copy.
function warnOnLegalPlaceholders() {
  try {
    const src = readFileSync(
      new URL("./lib/legal.ts", import.meta.url),
      "utf8"
    );
    const unresolved = [...src.matchAll(/^\s*(\w+):\s*"(\[[^"]*\])"/gm)];
    if (unresolved.length > 0) {
      console.warn(
        "\n⚠️  lib/legal.ts still has placeholder values — /terms and /privacy will display them verbatim:"
      );
      for (const [, key, value] of unresolved) console.warn(`      ${key}: ${value}`);
      console.warn("");
    }
  } catch {
    // Never let a check on copy break the build.
  }
}
warnOnLegalPlaceholders();

// The landing page's "tap Felix to hear him" sample is a committed binary
// (public/felix-hello.mp3), so unlike every signed-in surface it does NOT
// follow FISH_AUDIO_VOICE_ID — change the voice and the front door keeps
// playing the old one until someone re-runs `npm run felix:voice`. Nothing
// fails, nothing looks wrong in the diff, and the person who made the change
// has the old file cached, so they can't hear it either.
//
// scripts/felix-voice-sample.mjs records what went into the MP3 in
// lib/felixSample.stamp.json (see lib/felixSampleStamp.ts for why it stores
// fingerprints rather than the voice id). This compares that against the
// environment the build will actually speak in. A warning, not a thrown
// error, for the same reason as the legal copy above: refusing to deploy a
// working app over a stale audio file would be worse than the audio file.
//
// Deliberately duplicated rather than imported: this file is loaded before
// any path alias exists, and the check has to survive a missing stamp, a
// missing key and a malformed JSON without taking the build with it.
function warnOnStaleFelixSample() {
  try {
    const voiceId = process.env.FISH_AUDIO_VOICE_ID || "";
    // No key configured (a local build, a preview without secrets) means
    // nothing here can be compared against anything. Say nothing.
    if (!process.env.FISH_AUDIO_API_KEY) return;

    const fingerprint = (v: string) =>
      createHash("sha256").update(v).digest("hex").slice(0, 16);

    const take = readFileSync(new URL("./lib/felixSample.ts", import.meta.url), "utf8");
    // The exported string, reassembled from its "…" + "…" concatenation.
    const literal = take.slice(take.indexOf("FELIX_SAMPLE_TAKE"));
    const words = [...literal.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => m[1].replace(/\\(.)/g, "$1"))
      .join("");

    const expected = {
      voice: voiceId ? fingerprint(voiceId) : "stock",
      model: process.env.FISH_AUDIO_MODEL || "s2.1-pro-free",
      text: fingerprint(words),
    };

    let stamp: Record<string, unknown> | null = null;
    try {
      stamp = JSON.parse(
        readFileSync(new URL("./lib/felixSample.stamp.json", import.meta.url), "utf8")
      );
    } catch {
      stamp = null;
    }

    const drift: string[] = [];
    if (!stamp) drift.push("public/felix-hello.mp3 has never been stamped");
    else {
      if (stamp.voice !== expected.voice)
        drift.push(`the voice changed (sample cut in ${stamp.voice}, FISH_AUDIO_VOICE_ID is now ${expected.voice})`);
      if (stamp.model !== expected.model)
        drift.push(`the model changed (sample cut on ${stamp.model}, now ${expected.model})`);
      if (stamp.text !== expected.text)
        drift.push("FELIX_SAMPLE_TAKE changed, so the audio and its caption no longer agree");
    }
    if (drift.length === 0) return;

    console.warn(
      "\n⚠️  The landing page's Felix sample is out of date — visitors will hear the OLD voice:"
    );
    for (const line of drift) console.warn(`      ${line}`);
    console.warn("      Fix: npm run felix:voice, then commit the MP3 and its stamp.\n");
  } catch {
    // Never let a check on an audio file break the build.
  }
}
warnOnStaleFelixSample();

const csp = [
  "default-src 'self'",

  // Next's App Router inlines hydration payloads as <script> tags, and
  // app/layout.tsx ships its own inline bootstrap (the native/theme stamp
  // that must settle before first paint), so 'unsafe-inline' is required
  // until a nonce exists — see the block under script-src-attr for why that
  // is not a change this file can make alone. Even with it, this still
  // blocks scripts from any origin we haven't listed — the actual XSS
  // delivery vector.
  // Dev additionally needs 'unsafe-eval' for React Fast Refresh.
  // www.google.com + www.gstatic.com are reCAPTCHA v3, which backs Firebase
  // App Check (lib/appCheck.ts). reCAPTCHA loads its own second script from
  // gstatic, so listing only www.google.com silently breaks attestation.
  // va.vercel-scripts.com is dev-only: @vercel/analytics loads its debug
  // script from there when NODE_ENV is development, while production serves
  // the same thing same-origin from /_vercel/insights. These headers apply in
  // `next dev` too, so without it every local run logs a CSP violation and
  // analytics never initializes locally.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""} https://apis.google.com https://accounts.google.com https://www.google.com https://www.gstatic.com`,

  // 'unsafe-inline' above also re-enables inline event handlers, and those
  // are the cheaper half of the XSS surface: injected markup like
  // <img onerror=fetch(...)> needs no <script> tag and no allow-listed
  // origin, so the host list above does nothing to stop it. React binds
  // every listener with addEventListener and never emits an on* attribute,
  // and nothing in app/ or components/ writes one by hand, so switching them
  // off costs us nothing. Browsers that don't implement script-src-attr
  // (Firefox, Safari) ignore the directive rather than mis-parsing the
  // policy, so the worst case here is no change, not a broken page.
  "script-src-attr 'none'",

  // TODO(csp): the remaining weakness is 'unsafe-inline' in script-src, and
  // removing it takes more than this file. Next 16 only nonces its inline
  // scripts when the REQUEST carries a Content-Security-Policy header with a
  // 'nonce-…' in it, and headers() here sets response headers, so the whole
  // migration is:
  //   1. a proxy.ts (Next 16's renamed middleware) that mints a fresh
  //      base64 nonce per request and sets the CSP on both the forwarded
  //      request headers and the response, with a matcher that skips
  //      /_next/static, /_next/image and next/link prefetches;
  //   2. `nonce` props on the hand-written inline scripts — the bootstrap in
  //      app/layout.tsx and the JSON-LD block on every marketing page — read
  //      from headers().get("x-nonce"), since Next only nonces its own tags;
  //   3. accepting that every nonced page becomes dynamically rendered. A
  //      nonce cannot be baked in at build time, so /, /pricing, /about and
  //      the legal pages all lose static generation. That is the real cost,
  //      and it is a deploy-shape decision, not a header tweak.
  // Half of this is worse than none of it: a proxy that sets the header but
  // misses the layout bootstrap ships an app whose theme stamp is blocked on
  // first paint, which is precisely the flicker that script exists to avoid.

  // Tailwind injects styles inline.
  "style-src 'self' 'unsafe-inline'",

  // blob: covers canvas/waveform rendering; data: covers inlined icons.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob:",

  // XHR/WebSocket targets: Firebase Auth (identitytoolkit, securetoken),
  // Firestore (incl. its streaming transport), and Stripe's API.
  "connect-src 'self' https://*.googleapis.com https://*.google.com https://*.firebaseio.com wss://*.firebaseio.com https://api.stripe.com",

  // The Google sign-in popup renders in an iframe from the Firebase auth
  // domain; Stripe may embed its own frames during Checkout.
  //
  // auth.elovox.app is the custom auth domain. Listed AHEAD of the switch on
  // purpose: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN bakes in at build time, so if
  // the domain flips before this line ships, sign-in breaks with nothing but
  // a CSP violation in the console to explain it. Allowing a domain we don't
  // use yet costs nothing; *.firebaseapp.com stays until the cutover is done.
  //
  // www.google.com is the reCAPTCHA challenge frame (App Check).
  "frame-src 'self' https://*.firebaseapp.com https://auth.elovox.app https://accounts.google.com https://www.google.com https://checkout.stripe.com https://js.stripe.com",

  // Where forms may post. Checkout/Portal are top-level redirects rather than
  // form posts, but listing them keeps a stricter policy from breaking later.
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",

  // Nobody may frame us — the modern replacement for X-Frame-Options.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",

  // Production only. `next dev` serves over plain http, and this directive
  // rewrites every subresource URL to https — so the dev server is asked for
  // https://localhost:3000/_next/... , which it does not speak, and the page
  // renders as unstyled HTML with no JS. A desktop browser hides this because
  // it is exempt for localhost; the iOS shell pointed at a dev server via
  // CAP_SERVER_URL is not, and gets the broken page.
  //
  // Nothing is lost by omitting it here: it only ever upgrades http, and in
  // production every URL is already https.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },

  // Two years, subdomains included, and preload-eligible. Only meaningful
  // over HTTPS, which is all Vercel serves.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },

  // Don't let a browser second-guess a declared Content-Type.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Redundant with frame-ancestors above, but still honored by older browsers.
  { key: "X-Frame-Options", value: "DENY" },

  // Send the full URL same-origin, only the origin cross-origin, and nothing
  // at all when downgrading to HTTP — so paths like /report/{id} never leak.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // The app records audio and (for camera coaching) video, so those two stay
  // enabled for our own origin. Everything else powerful is switched off.
  {
    key: "Permissions-Policy",
    value: [
      "camera=(self)",
      "microphone=(self)",
      "geolocation=()",
      "payment=(self)",
      "usb=()",
      "magnetometer=()",
      "accelerometer=()",
      "gyroscope=()",
      "interest-cohort=()",
    ].join(", "),
  },

  // Keeps cross-origin windows from getting a handle on ours.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  // There's an unrelated package.json in the home directory, so Next was
  // inferring ~/ as the workspace root and tracing files from outside the
  // project into the build. Pin it to this directory.
  turbopack: { root: import.meta.dirname },

  // Dev only (ignored in production builds). Next blocks dev resources —
  // including the HMR socket — for any origin that isn't localhost, and a
  // blocked socket makes the page reload-loop before client components mount.
  // 127.0.0.1 is the same server under a different origin, which is useful
  // precisely BECAUSE origins don't share IndexedDB: it stays signed out
  // while localhost:3000 holds a signed-in session, so both auth states can
  // be checked side by side without tearing down a test login.
  allowedDevOrigins: ["127.0.0.1"],

  // Don't advertise the framework/version to anyone fingerprinting the stack.
  poweredByHeader: false,

  async headers() {
    return [
      {
        // Every route, including API responses and static assets.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  // The auth handler, served from OUR domain. Firebase's popup/redirect
  // helpers and every email action link live under authDomain/__/auth/*, and
  // authDomain was stuck on sonoria-212c1.firebaseapp.com — so the Google
  // popup's address bar and every verification email said "sonoria" to a
  // user who signed up for Elovox. Proxying the handler paths through
  // elovox.app lets lib/firebase.ts declare authDomain: "elovox.app"
  // (already on Firebase's authorized-domains list) with no Firebase
  // Hosting setup and no waiting on the stuck auth.elovox.app ticket.
  // /__/firebase/* rides along because the handler fetches its init config
  // from there. Same-origin also tightens the popup: frame-src 'self' now
  // covers what used to need *.firebaseapp.com.
  // The three /for/<audience> landing pages were retired with the site
  // redesign — their content now lives in the homepage's own sections. They
  // were in the sitemap and had been indexed, so they redirect rather than
  // 404: a permanent redirect passes the link equity on to the page that
  // replaced them instead of dropping it.
  async redirects() {
    return [
      { source: "/for/job-candidates", destination: "/#modes", permanent: true },
      { source: "/for/students", destination: "/#modes", permanent: true },
      { source: "/for/founders", destination: "/#modes", permanent: true },
      // Anything else that was ever under /for/ goes to the front door.
      { source: "/for/:slug*", destination: "/", permanent: true },
    ];
  },

  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: "https://sonoria-212c1.firebaseapp.com/__/auth/:path*",
      },
      {
        source: "/__/firebase/:path*",
        destination: "https://sonoria-212c1.firebaseapp.com/__/firebase/:path*",
      },
    ];
  },
};

export default nextConfig;
