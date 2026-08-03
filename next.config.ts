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

const csp = [
  "default-src 'self'",

  // Next's App Router inlines hydration payloads as <script> tags, so
  // 'unsafe-inline' is required unless we move to nonces (which needs
  // middleware on every request). Even with it, this still blocks scripts
  // from any origin we haven't listed — the actual XSS delivery vector.
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
};

export default nextConfig;
