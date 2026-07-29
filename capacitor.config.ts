import type { CapacitorConfig } from '@capacitor/cli';

// The iOS app is a native shell around the deployed site, not a bundled copy
// of it. That is forced by the backend: app/api/* holds nodejs-runtime routes
// that read FIREBASE_SERVICE_ACCOUNT and STRIPE_SECRET_KEY, which a static
// export cannot produce and which must never ship inside an app bundle.
//
// Consequence worth remembering: every Vercel deploy ships to the app
// instantly, with no store review and no rollback. See CAPACITOR.md.

const config: CapacitorConfig = {
  appId: 'app.elovox.ios',
  appName: 'Elovox',

  // Not the real app — the offline screen. Capacitor requires a webDir even
  // when server.url is set, and this is the only thing users see when
  // elovox.app is unreachable.
  webDir: 'native-shell',

  server: {
    url: 'https://elovox.app',

    // Off-origin hosts the webview may navigate to internally. Anything NOT
    // listed here opens in the system browser instead — which mid-auth means
    // the user lands in Safari and never comes back to the app.
    //
    // checkout.stripe.com is deliberately absent: under the v1 billing
    // decision the app shows no prices and never opens Checkout, so Apple has
    // nothing to object to under the IAP rules.
    allowNavigation: [
      'elovox.app',
      '*.elovox.app',
      '*.firebaseapp.com',
      'accounts.google.com',
      '*.googleapis.com',
    ],
  },

  ios: {
    // true would unlock some restricted WebKit APIs but pins navigation to a
    // 10-entry WKAppBoundDomains list in Info.plist and breaks Google's OAuth
    // redirects. Leave false unless something specifically demands otherwise.
    limitsNavigationsToAppBoundDomains: false,

    // Let the web app's own safe-area handling position content, rather than
    // having the webview inset it a second time.
    contentInset: 'always',
  },
};

export default config;
