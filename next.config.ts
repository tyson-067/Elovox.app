import type { NextConfig } from "next";

// Security headers. Vercel serves none of these by default, so without this
// file the app ships with no clickjacking, MIME-sniffing, or content-injection
// protection at all.
//
// The CSP is deliberately allow-listed to the three third parties the browser
// actually talks to — Firebase Auth, Firestore, and Stripe — and nothing else.
// Fonts are self-hosted by next/font at build time, so no font CDN is needed.

const isDev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",

  // Next's App Router inlines hydration payloads as <script> tags, so
  // 'unsafe-inline' is required unless we move to nonces (which needs
  // middleware on every request). Even with it, this still blocks scripts
  // from any origin we haven't listed — the actual XSS delivery vector.
  // Dev additionally needs 'unsafe-eval' for React Fast Refresh.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://apis.google.com https://accounts.google.com`,

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
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://checkout.stripe.com https://js.stripe.com",

  // Where forms may post. Checkout/Portal are top-level redirects rather than
  // form posts, but listing them keeps a stricter policy from breaking later.
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",

  // Nobody may frame us — the modern replacement for X-Frame-Options.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
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
