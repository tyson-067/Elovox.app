import type { CapacitorConfig } from '@capacitor/cli';
// Type-only, but not inert: these plugins declare their own blocks on
// PluginsConfig via `declare module '@capacitor/cli'`, so importing them is
// what makes the SplashScreen and Keyboard keys below type-check at all.
import type { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';
import type {} from '@capacitor/splash-screen';

// The iOS app is a native shell around the deployed site, not a bundled copy
// of it. That is forced by the backend: app/api/* holds nodejs-runtime routes
// that read FIREBASE_SERVICE_ACCOUNT and STRIPE_SECRET_KEY, which a static
// export cannot produce and which must never ship inside an app bundle.
//
// Consequence worth remembering: every Vercel deploy ships to the app
// instantly, with no store review and no rollback. See CAPACITOR.md.

// The other consequence: the running app is always the *deployed* site, so a
// change to the native UI is not in the app until it ships. To try one before
// that, point the shell at a dev server and rebuild:
//
//   npm run dev
//   CAP_SERVER_URL=http://localhost:3000 npx cap sync ios && npx cap open ios
//
// The simulator shares the Mac's network, so localhost resolves; on a physical
// device use the Mac's LAN address instead. Info.plist carries
// NSAllowsLocalNetworking so the cleartext load is permitted — that key allows
// local hosts only and changes nothing about how the app talks to elovox.app.
//
// Never commit a build made this way: the URL is baked into
// ios/App/App/capacitor.config.json by `cap sync`.
const devServerUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'app.elovox.ios',
  appName: 'Elovox',

  // Not the real app — the offline screen. Capacitor requires a webDir even
  // when server.url is set, and this is the only thing users see when
  // elovox.app is unreachable.
  webDir: 'native-shell',

  server: {
    url: devServerUrl ?? 'https://elovox.app',
    // Only ever true for a dev server on http. Production is HTTPS and this
    // stays off, so the App Store build has no cleartext allowance at all.
    cleartext: devServerUrl?.startsWith('http://') || undefined,

    // Where the webview goes when elovox.app can't be reached. Without this
    // the user gets WebKit's own "cannot open page" — a Safari error sheet,
    // inside the app, which is the most website-shaped thing that can happen
    // to it. Points at native-shell/index.html, the offline screen.
    errorPath: 'index.html',

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

  plugins: {
    // The app is a webview onto a remote site, so "launched" and "ready to
    // look at" are separated by a network round trip. Left to itself the
    // splash hides the moment the webview exists — i.e. on a black screen —
    // and the user watches the site load, which is precisely the experience
    // of opening a browser.
    //
    // So the splash is held until the app says it has painted (see
    // components/NativeRuntime.tsx, and native-shell/index.html for the
    // offline path). Both callers must exist: whichever page wins the race,
    // one of them hides it. autoHide would race them and lose.
    SplashScreen: {
      // NOT launchAutoHide: false. The obvious reading of "hold it until the
      // app says it has painted" is to disable the timer entirely and let JS
      // own it — but then any failure that stops that one call from running
      // (a bad deploy, a JS exception before the effect, a webview that never
      // finishes) leaves the splash up forever, and the app is bricked behind
      // a picture with no way out but force-quit. There is no native timeout
      // underneath to catch it.
      //
      // So the timer stays as the backstop and JS races it. NativeRuntime
      // calls hide() as soon as the first frame is painted, which is well
      // under 3s on any normal launch, so this duration is only ever reached
      // when something has gone wrong — and reaching it shows the user a
      // loading app instead of a frozen one.
      launchAutoHide: true,
      launchShowDuration: 3000,
      // Long enough to read as a deliberate handoff rather than a blink, and
      // short enough that it never feels like it's covering something up.
      launchFadeOutDuration: 250,
      // No backgroundColor on purpose. It is a single value, and this app has
      // two themes; the Splash imageset carries a light and a dark variant
      // that iOS picks between, and a hardcoded colour here would flash the
      // wrong one behind them during the fade.
      showSpinner: false,
    },

    // resize: None because this app positions its own furniture. Every other
    // mode has WebKit resize the viewport under the dock and the title bar,
    // so both jump while the keyboard animates. NativeRuntime listens for the
    // keyboard events instead and moves exactly what should move.
    Keyboard: {
      resize: 'none' as KeyboardResize,
      // Follow the device, not a hardcoded choice — the app's own dark mode
      // defaults to the phone's setting, so this tracks it for free.
      style: 'DEFAULT' as KeyboardStyle,
    },

    // Without this block the native plugin's provider list defaults to empty,
    // and signInWithGoogle() rejects outright with "Google sign-in provider is
    // not enabled" — so "Continue with Google" was dead on iOS, on both
    // /login and /signup, and took change-email, change-password and
    // delete-account down with it (they all re-authenticate through the same
    // call).
    FirebaseAuthentication: {
      providers: ['google.com'],
      // The native layer hands back a Google ID token and nothing else; the
      // JS SDK owns the session. That is what lib/auth.ts assumes, and it is
      // what keeps App Check, firestore.rules and verifyVerifiedUser all
      // looking at exactly the same user object they see on the web.
      skipNativeAuth: true,
    },
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
