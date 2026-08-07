# Elovox → TestFlight

Written 2026-08-03 against `main` at `9845c68`. Everything a machine can verify
without your Apple account has been verified tonight:

- **The Release build archives cleanly** (`xcodebuild archive`, unsigned pass).
- **All three app icons are upload-legal**: 1024×1024, no alpha, square corners
  (light, dark, tinted).
- **`ITSAppUsesNonExemptEncryption` is `false`** in Info.plist, so App Store
  Connect asks no export-compliance questions at upload.
- **Prod is current** — the shell loads the deployed light-default pass.
- Version is **1.0 (1)**, bundle id **`app.elovox.ios`**, display name
  **Elovox**.

What tonight's automated run could NOT do, and why: signing needs your Apple
account. The team (`MZM9V2B5KN`, personal team on tysonthomasyoum@icloud.com)
has **no registered devices** — so Xcode cannot mint a development profile —
and **no distribution certificate** yet. Both fix themselves in the flow below.

---

## 0. Confirm the paid Developer Program

**As of 2026-08-06 this is the ONLY thing standing between the app and a
device.** The signing identity on this Mac is a PERSONAL team
(`MZM9V2B5KN`, "Tyson Youm"), and a Release build for `generic/platform=iOS`
fails on it like this:

```
error: Cannot create a iOS App Development provisioning profile for
"app.elovox.ios". Personal development teams, including "Tyson Youm", do not
support the Sign In with Apple capability.
```

That is not a new problem and nothing in the app caused it: Sign in with
Apple has been in `App/App.entitlements` since it was added for Guideline
4.8, and a personal team has never been able to sign it. TestFlight, a real
device, and the App Store are all gated on the $99/yr programme.

The simulator is unaffected and always has been — every feature in this app,
including the Dynamic Island and the Home Screen widget, has been verified
there.

### The moment enrolment completes, in order

1. Xcode → Settings → Accounts → add the Apple ID, pick the new **paid** team
   in Signing & Capabilities for BOTH targets (App and ElovoxWidgets).
2. Register the two identifiers. With automatic signing, Xcode creates App
   IDs on demand, so in practice this means opening Signing & Capabilities
   and letting it:
   - `app.elovox.ios` — needs **Sign in with Apple** and **App Groups**
   - `app.elovox.ios.widgets` — needs **App Groups**
3. Create App Group `group.app.elovox.ios` and tick it on both. This is the
   one thing that is genuinely paid-only and genuinely manual.
4. Rebuild. `ElovoxNativePlugin.capabilities()` returns
   `sharedStorage: true` once the group resolves — that flag exists precisely
   so "the widget is blank" and "the widget is broken" are distinguishable.

Until step 3, the Home Screen widget renders its placeholder rather than the
real streak and topic. Everything else — the Dynamic Island, the Siri
shortcut, the share sheet — needs no App Group and works the moment the app
runs on a device.


TestFlight requires the $99/yr Apple Developer Program, not just an Apple ID.
Check at https://developer.apple.com/account — if the page shows "Membership"
with an expiry date, you're in. If it offers to enroll you, enroll now;
approval can take a day.

## 1. Plug your iPhone in once

Cable the phone to this Mac, open Xcode → Window → Devices and Simulators,
and trust the computer on the phone. That registers the device to your team,
which is the thing tonight's archive attempt was missing. (You want the phone
connected anyway — the on-device checklist is the next task after TestFlight.)

## 2. Create the App Store Connect record

https://appstoreconnect.apple.com → Apps → **+** → New App:

- Platform: **iOS**
- Name: **Elovox** (public; if taken, fall back to "Elovox: Speaking Coach")
- Primary language: **English (U.S.)**
- Bundle ID: pick **app.elovox.ios** from the dropdown.
  - If it's not in the dropdown, register it first at
    https://developer.apple.com/account/resources/identifiers → **+** →
    App IDs → App, id `app.elovox.ios`, description "Elovox". No extra
    capabilities needed (no push, no Sign in with Apple — yet, see Risks).
- SKU: `elovox-ios` (internal only, never shown)
- Full access: yes

## 3. Archive and upload

In Xcode: open `ios/App/App.xcodeproj`, select the **App** scheme and
**Any iOS Device (arm64)**, then Product → **Archive**. When the Organizer
opens: **Distribute App → TestFlight & App Store → Upload**. Accept the
defaults — "Automatically manage signing" will create the distribution
certificate and App Store profile on the spot.

CLI equivalent, if you'd rather not click:

```bash
cd "/Users/tysonyoum/elovox app/sonoria/ios/App" && xcodebuild -project App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath build/Elovox.xcarchive archive -allowProvisioningUpdates
```

Then upload the archive from Xcode's Organizer (Window → Organizer). The
upload takes a few minutes; processing on Apple's side takes ~15 more before
the build appears in TestFlight.

## 4. The privacy questionnaire

App Store Connect → your app → **App Privacy**. Answer EXACTLY this — it
mirrors `ios/App/App/PrivacyInfo.xcprivacy`, and the two must agree.
"Collected" includes data processed then discarded; transmission counts,
retention does not change the answer.

**Do you or your third-party partners collect data from this app?** Yes.

| ASC category | Data type | Purpose | Linked to identity? | Tracking? |
|---|---|---|---|---|
| Contact Info | Email Address | App Functionality | **Yes** | No |
| Contact Info | Name | App Functionality | **Yes** | No |
| User Content | Audio Data | App Functionality | **Yes** | No |
| User Content | Photos or Videos | App Functionality | **Yes** | No |
| User Content | Other User Content | App Functionality | **Yes** | No |
| Usage Data | Product Interaction | Analytics | **No** | No |

Nothing is used for tracking; answer **No** to every tracking question.
Declare nothing else — no location, no identifiers, no diagnostics beyond the
above. (Vercel Analytics is cookieless and aggregate: that's the Product
Interaction row.)

Privacy policy URL (required on this screen): `https://elovox.app/privacy`.

## 5. Internal testing

TestFlight tab → Internal Testing → **+** → create a group ("Founders"),
add your own Apple ID email as tester, toggle automatic distribution on.
Internal testing needs **no review** — the build is installable minutes after
processing. Install TestFlight on the phone, accept the invite, install
Elovox.

External testers (later) need a one-time light Beta App Review pass.

## 6. First run on the phone — the checklist that matters

From CAPACITOR.md, the items only a physical device can prove:

- [ ] Launch goes straight to Today (or Log in), never the landing page
- [ ] Google sign-in completes and lands back signed in
- [ ] Mic prompt shows the Elovox usage string; a full rep returns a score
- [ ] Camera pass stays inline (no fullscreen hijack)
- [ ] Airplane mode → offline shell renders, Retry works
      (This one FAILED for the whole life of the app until 2026-08-06: Retry
      was `location.reload()` on a page Capacitor loads from the BUNDLE, so it
      re-served the error screen forever and force-quit was the only way out.
      Test it properly — go offline, come back, and tap it.)
- [ ] Status bar glyphs stay legible on the Report, the Den and the booth
      (all three are ink-topped in light mode; `data-topbar` drives this)
- [ ] No price or upgrade CTA anywhere
- [ ] Change-password / change-email on a Google account doesn't hang
- [ ] Daily reminder fires and its tap opens /practice?daily=1

## Risks worth knowing before you hit Upload

- **~~Guideline 4.8 (Login Services)~~ — RETIRED.** Sign in with Apple ships:
  the entitlement is in `App.entitlements` and the button is on both auth
  screens. This risk is closed.

- **Guideline 3.1.1, and the fact that nobody can pay on iOS.** There is no
  StoreKit anywhere in this project, which is compliant — no purchase means no
  IAP obligation — but it has two consequences worth deciding about ON PURPOSE
  rather than discovering in review. An iOS-only user can never become
  Premium; and iOS revenue is structurally zero. The Den now describes what
  Premium contains (features only, no price, no route), so a reviewer with a
  fresh account sees intent rather than a wall of padlocks. If review still
  queries it, the answer is that Premium is an account-level entitlement and
  the app sells nothing.

- **A demo account is mandatory.** `RequireAuth` bounces to /login, so a
  reviewer sees NOTHING without credentials, and it must be email/password —
  Sign in with Apple and Google are both unusable for them. App Store Connect
  → App Review Information → Sign-In Required.
- **Guideline 4.2 (minimum functionality).** Already mitigated by design:
  native entry routing, native Google sign-in, haptics, local notification
  reminders, offline screen, no marketing pages. The record of this is in
  CAPACITOR.md's audit section.
- **The app is the deployed site.** A bad Vercel deploy breaks the TestFlight
  build instantly. Nothing to do — just the standing fact.
