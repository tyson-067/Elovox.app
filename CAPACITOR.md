# Elovox on iOS — Capacitor build guide

Written 2026-07-29 against the repo as of `e00704b`. Ordered so that each step
either unblocks the next or kills the plan early. Do not skip ahead: steps 0–2
decide the shape of everything after them.

---

## Step 0 — The machine is not ready (do this first, it is a long download)

Two hard blockers, verified on this machine today:

- `xcodebuild` reports the active developer directory is
  `/Library/Developer/CommandLineTools`. **Full Xcode is not installed.** You
  cannot build, sign, or ship an iOS app without it.
- `pod` is not on PATH. **CocoaPods is not installed.** Capacitor's iOS
  platform installs its plugins through Pods.

```bash
xcode-select -p
```

1. Install Xcode from the Mac App Store (~10–15 GB, plan for an hour on a
   normal connection). Open it once and let it install the additional
   components it asks for.
2. Point the toolchain at it — needs your password:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

3. Accept the license and install CocoaPods:

```bash
sudo xcodebuild -license accept && brew install cocoapods
```

4. Confirm all three:

```bash
xcodebuild -version && pod --version && xcrun simctl list devices available | head
```

Do not start step 3 until these three print without error.

---

## Step 1 — Decide the shell model (the decision the roadmap flags as #1)

The app has live server routes: `app/api/analyze`, `app/api/daily`,
`app/api/speech`, `app/api/stripe/*`, `app/api/account/*`, `app/api/admin/*`.
Several are `runtime = "nodejs"` and read `FIREBASE_SERVICE_ACCOUNT` and
`STRIPE_SECRET_KEY`. **`next export` cannot produce these**, and the secrets
must never ship inside an app bundle. So a bundled static export is off the
table without splitting the backend out — which is weeks of work, not a day.

**Recommendation: native shell pointed at `https://elovox.app`** — i.e.
`server.url` in the Capacitor config. Ship native code only for the things the
web app genuinely cannot do in a webview (Google sign-in, and later push).

Understand the cost before you commit:

- **App Store Guideline 4.2 (minimum functionality).** A pure website wrapper
  is the single most common rejection for this architecture. The mitigation is
  to make the app do things Safari cannot: native Google Sign-In, native
  haptics on rep completion, native share of a report, push notifications for
  the daily rep, an offline screen. Add at least two of those before the first
  submission — they also happen to be genuine product wins.
- **Everything ships when you deploy the web app.** That is the upside (no
  review cycle for content changes) and the risk (a bad Vercel deploy breaks
  the shipped app instantly, with no rollback through the store).
- **Offline is a blank screen** unless you build the fallback in step 4.

If you'd rather not carry the 4.2 risk, the alternative is a real native
rewrite of the practice screen — a different project, not a variation on this
one. Decide now, in writing, and don't revisit it mid-build.

---

## Step 2 — Stripe vs. Apple IAP (decide before you build any paywall screen)

Apple's rules: a digital subscription **unlocked and consumed inside the app**
must use In-App Purchase. Elovox Premium is exactly that. Three options:

1. **Web-only upgrade (recommended for v1).** The iOS app never shows a price,
   never shows an upgrade button, never links to Checkout. Users who are
   already Premium get their features; users who aren't see the feature gated
   with a neutral message and no purchase path. This is what "reader-style"
   apps do and it passes review reliably, but it converts badly — you lose
   every in-app upgrade impulse.
   - Note: **linking out to your own site to buy is not a safe workaround.**
     The US "link-out entitlement" rules have moved repeatedly; do not build a
     business on this year's version of them.
2. **StoreKit IAP.** Correct, converts well, costs 15–30%, and is real work:
   an IAP product in App Store Connect, a purchase plugin, App Store
   server-notification webhooks that write the same entitlement your Stripe
   webhook writes, and receipt validation. Your entitlement model is a single
   bit on `users/{uid}/profile/plan` (`lib/plan.ts`, written only by the
   webhook), which is the good news — a second writer of that same bit is
   tractable. Budget several days, not an afternoon.
3. **Reader exemption.** Elovox is coaching with in-app analysis, not a
   catalogue of previously purchased content. Weak argument. Skip it.

**Ship v1 with option 1, plan option 2 for v1.1.** It gets you into TestFlight
this week instead of next month, and IAP is additive later.

Concretely for v1, gate on native and hide the paywall:

```ts
import { Capacitor } from "@capacitor/core";
export const canPurchaseInApp = !Capacitor.isNativePlatform();
```

Then use `canPurchaseInApp` to hide every upgrade CTA and price. `/api/stripe/checkout` stays as it is — it just never gets called from iOS.

---

## Step 3 — Install Capacitor and add iOS

From `sonoria/`. Check the current major on capacitorjs.com first; `@latest`
below assumes you want the newest.

```bash
npm install @capacitor/core@latest && npm install -D @capacitor/cli@latest
```

Initialize. **App name `Elovox`, bundle id `app.elovox.ios`** (reverse-DNS,
lowercase, no hyphens; it is permanent once submitted — you cannot rename a
bundle id later, only ship a new app).

```bash
npx cap init Elovox app.elovox.ios --web-dir=native-shell
```

Then add the platform (this is what needs CocoaPods from step 0):

```bash
npm install @capacitor/ios@latest && npx cap add ios
```

Add to `.gitignore` before the first commit: `ios/App/Pods/`,
`ios/App/App/public/`, `ios/App/Podfile.lock` (keep the lock file actually —
commit it; ignore only `Pods/`).

---

## Step 4 — The offline fallback that `webDir` points at

Capacitor requires a `webDir` even when `server.url` is set. Use it for the
offline screen rather than leaving a stub — this is the only thing users see
when elovox.app is unreachable.

Create `sonoria/native-shell/index.html` with a self-contained page: the fox,
one line ("Elovox needs a connection to run your rep"), and a Retry button
that calls `location.reload()`. No external assets — inline the CSS and use a
data-URI or inline SVG for the logo. It must render with zero network.

---

## Step 5 — `capacitor.config.ts`

Create `sonoria/capacitor.config.ts`:

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.elovox.ios",
  appName: "Elovox",
  webDir: "native-shell",

  server: {
    // The app IS the deployed site. Every code change ships on deploy.
    url: "https://elovox.app",
    // Off-origin hosts the webview may navigate to internally. Anything not
    // listed opens in the system browser instead, which for an auth or
    // billing flow means the user never comes back.
    allowNavigation: [
      "elovox.app",
      "*.elovox.app",
      "*.firebaseapp.com",
      "accounts.google.com",
      "*.googleapis.com",
    ],
  },

  ios: {
    // The recording UI must not be hijacked into the fullscreen player.
    limitsNavigationsToAppBoundDomains: false,
    contentInset: "always",
  },
};

export default config;
```

Notes on choices above:

- `checkout.stripe.com` is deliberately **not** in `allowNavigation` — under
  step 2 option 1 the app never navigates there.
- `limitsNavigationsToAppBoundDomains: true` would enable some restricted
  WebKit APIs but locks navigation to a `WKAppBoundDomains` list in
  `Info.plist` (max 10 entries) and will break Google sign-in redirects. Leave
  it false unless something specific demands it.

Then sync:

```bash
npx cap sync ios
```

---

## Step 6 — Google sign-in (the known blocker)

`lib/auth.ts:95` uses `signInWithPopup`, and `lib/auth.ts:151` uses
`reauthenticateWithPopup` for the account-management path. **Neither works in
a WKWebView** — there is no popup, and the COOP fix shipped today in
`components/AuthForm.tsx` is a web-only workaround that does not carry over.

`signInWithRedirect` is *also* unreliable here: Google increasingly blocks
OAuth in embedded webviews (`disallowed_useragent`), and Firebase's redirect
flow depends on cross-origin storage that Safari's ITP degrades. Do not build
on it.

**Use the native plugin and hand Firebase a credential.**

```bash
npm install @capacitor-firebase/authentication
npx cap sync ios
```

Then branch in `lib/auth.ts` rather than replacing the web path — the web app
keeps its popup, which works fine and is already tested:

```ts
import { Capacitor } from "@capacitor/core";

export async function signInWithGoogle(): Promise<void> {
  const { GoogleAuthProvider, signInWithPopup, signInWithCredential } =
    await import("firebase/auth");

  if (!Capacitor.isNativePlatform()) {
    await signInWithPopup(getAuthInstance(), new GoogleAuthProvider());
    return;
  }

  // Native: the system account picker returns an ID token, which we exchange
  // for a Firebase session on the JS side so every downstream call (App Check,
  // Firestore rules, the `verifyVerifiedUser` checks in the API routes) sees
  // the same user it always has.
  const { FirebaseAuthentication } = await import(
    "@capacitor-firebase/authentication"
  );
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) throw new Error("Google sign-in was cancelled.");
  await signInWithCredential(
    getAuthInstance(),
    GoogleAuthProvider.credential(idToken)
  );
}
```

Apply the same branch to `reauthenticate()` at `lib/auth.ts:151`, using
`reauthenticateWithCredential` on the native side. Miss it and change-email /
change-password / delete-account silently hang for Google users on iOS.

iOS-side wiring, all in Xcode:

1. Download `GoogleService-Info.plist` from the Firebase console (iOS app,
   bundle id `app.elovox.ios` — register it there first) and drag it into
   `ios/App/App/` **in Xcode**, with "Copy items if needed" ticked. Dropping
   it in Finder does not add it to the target and the app will crash at launch.
2. In that plist, copy `REVERSED_CLIENT_ID`.
3. In Xcode → target App → Info → URL Types, add a URL Scheme equal to that
   reversed client id.
4. Firebase console → Authentication → Settings → Authorized domains: confirm
   `elovox.app` is listed.

**Also check `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`.** Roadmap item 7.4 says the
email action URL still points at `sonoria-212c1.firebaseapp.com` and is stuck
on a Firebase ticket. That does not block native sign-in, but verification and
reset emails opened on the phone will land on the legacy domain — worth seeing
once on-device so you know what a new user actually experiences.

---

## Step 7 — Mic and camera

Add to `ios/App/App/Info.plist` (edit as source, not the property list GUI, so
you can see exactly what you wrote):

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Elovox records your voice so it can analyse your delivery and score your rep.</string>
<key>NSCameraUsageDescription</key>
<string>Elovox watches your posture, gestures, and eye contact during a rep to coach your body language.</string>
```

Write these carefully — App Review reads them, and a vague purpose string is a
rejection on its own.

Then in Xcode, target App → Signing & Capabilities → **+ Capability →
Background Modes → Audio** only if recording must survive backgrounding. If a
rep is always foreground, skip it — an unused background mode invites review
questions.

Two webview behaviours to verify, not assume:

- **`getUserMedia` needs a user gesture** in WKWebView, and iOS is stricter
  than desktop Safari about what counts. `app/practice/page.tsx:469` starts the
  recorder inside a click handler, which should be fine — but any `await` that
  resolves before the `getUserMedia` call can break the gesture chain. Test it,
  don't reason about it.
- **The recorded MIME type will differ.** Desktop Chrome gives you
  `audio/webm`; WKWebView gives `audio/mp4`. `app/practice/page.tsx:484` builds
  the blob from `recorder.mimeType`, so it propagates correctly — but confirm
  end-to-end that `/api/analyze` accepts what iOS actually produces, and log
  the received type on the first real device run. Also confirm the Premium
  camera pass: `lib/frames.ts` draws the live `<video>` to a canvas, which
  needs `playsinline` on the element or iOS takes it fullscreen.

---

## Step 8 — First build and a real recording on a real device

Simulator first, because it is fast:

```bash
npx cap open ios
```

Pick an iPhone simulator, hit Run. **The simulator has no camera and a fake
mic** — it proves the app launches and loads elovox.app; it does not prove
recording. Then, on a physical iPhone over cable:

1. Xcode → Signing & Capabilities → tick "Automatically manage signing", pick
   your team. This is where you need the paid Apple Developer account
   ($99/yr — enrolment can take a day or more, so start it now if you haven't).
2. Select your device, Run. Trust the developer profile on the phone when
   prompted (Settings → General → VPN & Device Management).
3. **Do one full real rep**: sign in with Google, record, get a score. That
   single run exercises everything in steps 6–7 at once and is the only
   meaningful proof.

While you are signed in on the device, this also clears the "one real signed-in
rep" item on the roadmap — check whether the post-recording loader's stage
timings (2.5s / 11s / 22s) match a real analysis, and whether the
`longestStreak` badge renders.

---

## Step 9 — TestFlight

1. App Store Connect → Apps → **+** → New App. Bundle id must match
   `app.elovox.ios` exactly.
2. App icon: 1024×1024, **no alpha channel, no rounded corners** — a
   transparent PNG is an automatic upload rejection. Given the open question
   about fox legibility after the crop, check the icon at 60×60 before you
   upload it.
3. Xcode → Product → Archive → Distribute App → TestFlight.
4. Fill in the export-compliance answer (Elovox uses only HTTPS, so it is the
   standard exempt-encryption answer) and the privacy questionnaire — you
   collect email, audio, and video, and you must declare all three.
5. Internal testing needs no review and is available in minutes. External
   testing needs a (fast, light) review pass.

---

## Verification checklist for the first device run

- [ ] App launches to the real elovox.app, not the offline shell
- [ ] Airplane mode → offline shell renders and Retry works
- [ ] Google sign-in completes and lands back in the app signed in
- [ ] Email/password sign-in still works
- [ ] Mic permission prompt shows your usage string
- [ ] A recording completes and returns a score
- [ ] Camera pass: video stays inline, does not go fullscreen
- [ ] No price or upgrade CTA is visible anywhere in the app
- [ ] Change-password / change-email for a Google account does not hang
- [ ] Account deletion still works

---

## Sequencing, if you only get one day

Step 0 (start the Xcode download **first thing**, it runs unattended) →
step 1 and 2 decisions written down while it downloads → steps 3–5 →
step 6 → step 8 on the simulator → step 7 → step 8 on device.
TestFlight can wait for day two; a real recording on a real device cannot.

---

## The native UI

The app loads the same deployment as the website, but it does not look like
it. Everything is scoped to `html[data-native]`, which the inline script in
`app/layout.tsx` stamps before first paint, so the browser is untouched.

What changes:

- **Entry.** `/` is a router inside the app, not a screen —
  `components/NativeEntry` replaces it with `/dashboard` or `/login`. An app
  that opens on a marketing landing page is a Guideline 4.2 problem.
- **Chrome.** The header, the sub-nav, and the footer are `native-hide`.
  `components/NativeShell` puts an iOS title bar (large title collapsing on
  scroll, back chevron on pushed screens) and a bottom dock in their place.
- **The dock.** Today · Progress · record · Library · Account. The record node
  is the signature element and the only saturated colour in the interface; it
  goes straight to `/practice?daily=1`. The Premium sections that lost a tab
  are cards on Today (`components/NativeSections`).
- **Dark mode.** Native only, `data-theme` on `<html>`, chosen in Account and
  defaulting to the phone's setting. It re-defines the semantic colour tokens
  and nothing else — no screen has a dark variant.
- **Touch.** Tap highlights, latching hover states, overscroll, and text
  selection on chrome are all switched off in `globals.css`; safe-area insets
  come from `viewportFit: "cover"`.

To work on any of it without Xcode, run the dev server and open
`http://localhost:3000/dashboard?native=1`. The override is compiled out of
production builds.

### Checks worth repeating on device

- [ ] Launch goes straight to Today (or Log in), never the landing page
- [ ] The dock clears the home indicator, and the title bar clears the notch
- [ ] Dark mode survives a cold launch with no flash of light
- [ ] Tapping a card leaves no stuck hover state behind

---

## The native runtime

Everything above is layout. `components/NativeRuntime.tsx` is the behaviour —
the parts of "this is an app" that live outside React's tree. It renders
nothing and is inert in a browser.

- **The splash is held until the app has painted.** The shell is a webview
  onto a remote site, so hiding it when the webview exists means hiding it
  onto a blank screen the user then watches load. Config keeps the native 3s
  timer as a backstop: a splash only JS can dismiss is one bad deploy away
  from an app frozen behind a picture. `Splash.imageset` is the app's own
  background gradient, light and dark, so the handoff has nothing to see.
- **Haptics under every tap**, via one delegated `pointerdown` listener
  (`lib/haptics.ts`) rather than a call added to hundreds of controls. Dock
  tabs get the lighter selection detent; everything else gets an impact.
- **The status bar follows `data-theme`**, and is reasserted on resume.
- **The keyboard** moves the dock out of the way and nothing else
  (`Keyboard.resize` is `None`; `data-keyboard` on `<html>` drives the CSS).
- **Edge-swipe back**, tracking the finger so it can be abandoned halfway.
  Deliberately not WKWebView's `allowsBackForwardNavigationGestures`, which
  drives the webview's history and disagrees with Next's router.

Screens fade-and-slide in on navigation. The class is re-armed per navigation
from the runtime, not matched in CSS: React reuses a DOM node when two routes
have the same shape, and a reused node keeps its finished animation forever.
The **outgoing** screen is not animated — a true iOS push needs the View
Transitions API, which needs React's `<ViewTransition>`, which is not in
stable React 19.2. That is the one piece of this still missing.

### Working on it without deploying

The app always loads the *deployed* site, so native-UI changes are not in it
until they ship. Point the shell at a dev server instead:

```bash
CAP_SERVER_URL=http://localhost:3000 npx cap sync ios && npx cap open ios
```

`Info.plist` carries `NSAllowsLocalNetworking` for the cleartext load — local
hosts only, nothing changes about how the app reaches elovox.app. **Re-run
`npx cap sync ios` with no `CAP_SERVER_URL` before committing**, or the dev
URL stays baked into `ios/App/App/capacitor.config.json`.

For quick CSS work with no Xcode at all, `?native=1` still paints the native
UI in a desktop browser.
