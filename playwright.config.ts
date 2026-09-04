import { defineConfig, devices } from "@playwright/test";

/**
 * These are the checks that were being run by hand, one screenshot at a time,
 * every time anything shipped. Three of them are the ones that actually cost
 * money if they regress:
 *
 *   - the App Store gate. The iOS app is a WKWebView pointed at this exact
 *     deployment, so a pricing CTA that loses its `web-only` marker becomes a
 *     Guideline 3.1.1 rejection.
 *   - reduced motion. Two separate bugs shipped where content either kept
 *     animating or would have vanished for readers who asked it not to.
 *   - horizontal overflow. Cheap to introduce, invisible on the desktop the
 *     change was written on.
 *
 * Run against a PRODUCTION build, not `next dev`: dev serves unminified CSS in
 * a different order, and at least one bug in this repo's history only appeared
 * once Tailwind had actually tree-shaken.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
    // Headless Chromium has no microphone, so getUserMedia never resolves and
    // the recorder tests' takes never start — their assertions would then pass
    // or fail for entirely the wrong reason. Here rather than `test.use()` in
    // the one spec that needs it: launch options set per-file force a SECOND
    // browser launch, and the extra cold start is what makes an otherwise
    // green suite flake on the first parallel wave.
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Firebase blanked so the auth gate is skipped and the signed-in
        // surface renders from the localStorage fallback — the project's own
        // demo mode, which is the only way to reach those screens without an
        // account. See lib/firebase.ts.
        // NEXT_PUBLIC_DEMO_MODE=1 is required now, and saying so is the point:
        // blanking the Firebase vars no longer opens the app on its own (see
        // isDemoMode in lib/firebase.ts — a missing key must fail closed). The
        // recording specs need the signed-in surface, so this server asks for
        // it out loud.
        command:
          "NEXT_PUBLIC_FIREBASE_API_KEY= NEXT_PUBLIC_FIREBASE_PROJECT_ID= NEXT_PUBLIC_FIREBASE_APP_ID= NEXT_PUBLIC_DEMO_MODE=1 npm run build && npm run start -- -p 3100",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
