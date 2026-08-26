import { devices, expect, test } from "@playwright/test";

/* ---------------------------------------------------------------------------
   The phone must reach everything the desktop reaches.
   ---------------------------------------------------------------------------
   The Explore menu was `hidden md:block`, and the reasoning written next to it
   — "on mobile the footer and the homepage carry these links" — did not survive
   being checked. Diffing what is actually reachable at 1280px against an
   iPhone 13 found SEVEN destinations a phone could not get to from an inner
   page: all three /for/* audience landing pages, the homepage's own sections,
   and the pricing FAQ. The footer carries legal and company links, not product
   ones, so from /terms on a phone those pages had no route in at all.

   This test is the diff, run every time.
   --------------------------------------------------------------------------- */

const ROUTES = ["/terms", "/pricing", "/about"];

async function reachable(page: import("@playwright/test").Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  // Auth resolves after mount and AuthNav renders a different set for signed-in
  // visitors; give it a beat so the comparison is like-for-like.
  await page.waitForTimeout(1200);
  const trigger = page.getByRole("button", { name: /explore/i });
  if (await trigger.count()) {
    // Click, then wait for the PANEL rather than for a fixed beat.
    //
    // The fixed 300ms was a timing assumption, and under a loaded machine —
    // the whole suite in parallel, or a build still finishing — it lost. A
    // click that lands before React has hydrated is swallowed entirely, so no
    // amount of waiting afterwards helps; the menu simply never opens and the
    // test reports every link inside it as unreachable on a phone. One retry
    // covers that, since hydration is certainly done by the second attempt.
    //
    // This removes the race, not the check: if the panel genuinely never
    // opens, the links stay missing and the assertion below still fails.
    const panel = page.locator(".nav-menu");
    await trigger.first().click();
    try {
      await panel.waitFor({ state: "visible", timeout: 2000 });
    } catch {
      await trigger.first().click();
      await panel.waitFor({ state: "visible", timeout: 5000 });
    }
  }
  return page.evaluate(() =>
    [
      ...new Set(
        [...document.querySelectorAll("a[href]")]
          .filter((a) => {
            const r = a.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((a) => a.getAttribute("href"))
          .filter((h): h is string => !!h && h.startsWith("/"))
      ),
    ].sort()
  );
}

for (const route of ROUTES) {
  test(`a phone reaches everything a desktop reaches on ${route}`, async ({ browser }) => {
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const mobile = await browser.newContext({ ...devices["iPhone 13"] });

    const onDesktop = await reachable(await desktop.newPage(), route);
    const onMobile = await reachable(await mobile.newPage(), route);

    await desktop.close();
    await mobile.close();

    expect(onDesktop.length, "desktop should expose a real nav").toBeGreaterThan(8);
    const missing = onDesktop.filter((h) => !onMobile.includes(h));
    expect(missing, `unreachable on a phone from ${route}`).toEqual([]);
  });
}

test("the header still fits at every phone width", async ({ page }) => {
  // The 375px budget measured in AuthNav.tsx is real: a fourth top-level item
  // does not shrink, it wraps onto the wordmark and breaks the CTA in two.
  // Adding the menu trigger had to PAY for itself, which it does by moving
  // Pricing into the panel below md.
  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/terms", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const header = document.querySelector("header")!;
      const row = header.querySelector("div")!;
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        inner: row.scrollWidth - row.clientWidth,
      };
    });
    expect(m.page, `page overflows at ${width}px`).toBeLessThanOrEqual(1);
    expect(m.inner, `header row overflows at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test("the mobile menu panel opens on screen, not off the side of it", async ({ browser }) => {
  // It first shipped anchored `absolute right-0` to the trigger, which works at
  // md where the trigger sits far right — and pushed a 358px panel most of the
  // way off the LEFT of a 390px viewport. It rendered, it was clickable, and it
  // was unreadable.
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto("/terms", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /explore/i }).click();

  const panel = page.locator(".nav-menu");
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  await ctx.close();
});
