import { devices, expect, test } from "@playwright/test";

/* ---------------------------------------------------------------------------
   The phone must reach everything the desktop reaches.
   ---------------------------------------------------------------------------
   Diffing what is actually reachable at 1280px against an iPhone 13 once found
   seven destinations a phone could not get to from an inner page — the
   homepage's own sections and the pricing FAQ among them. The footer carries
   legal and company links, not product ones, so from /terms on a phone those
   pages had no route in at all.

   The header has since become a floating pill whose five section links
   collapse into a full-screen menu below 980px rather than into a dropdown
   panel. The mechanism changed; the requirement did not, and this is still
   the diff.

   This test is the diff, run every time.
   --------------------------------------------------------------------------- */

const ROUTES = ["/terms", "/pricing", "/about"];

async function reachable(page: import("@playwright/test").Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  // Auth resolves after mount and AuthNav renders a different set for signed-in
  // visitors; give it a beat so the comparison is like-for-like.
  await page.waitForTimeout(1200);
  const trigger = page.getByRole("button", { name: /open menu/i });
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
    const panel = page.locator(".site-menu");
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
  // The pill is `min(1340px, 100% - 28px)` wide and its row holds the brand,
  // the account cluster and the burger below 980px. That has to fit inside a
  // 320px viewport with nothing spilling out of the curve.
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
  // Its predecessor shipped anchored `absolute right-0` to the trigger, which
  // works at md where the trigger sits far right — and pushed a 358px panel
  // most of the way off the LEFT of a 390px viewport. It rendered, it was
  // clickable, and it was unreadable. This one is a full-screen overlay, so
  // the check is cheap to keep and would catch the same class of mistake.
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto("/terms", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /open menu/i }).click();

  const panel = page.locator(".site-menu");
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  await ctx.close();
});

test("a menu link closes the menu, and the page cannot scroll behind it", async ({ browser }) => {
  // Both halves of this were real bugs, and neither was catchable by the
  // tests above, which open the menu and then only enumerate hrefs.
  //
  // 1. Openness was derived as `openedOn === usePathname()`, and usePathname
  //    excludes the hash. Three of the five section links are same-page
  //    hashes, so tapping a section link from / scrolled the page behind an
  //    overlay that stayed at full opacity until you found the burger again.
  // 2. The scroll lock was `body { overflow: hidden }`, which works by
  //    overflow propagating from body to the viewport — and that propagation
  //    stops the moment the root has a non-visible overflow, which globals.css
  //    sets (`html { overflow-x: clip }`). Measured: 600px of scroll behind
  //    the open menu.
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const panel = page.locator(".site-menu");
  await page.getByRole("button", { name: /open menu/i }).click();
  await expect(panel).toBeVisible();

  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(400);
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - before),
    "the page scrolled behind the open menu"
  ).toBeLessThan(8);

  // "Ways to practice" (/#modes), not "How it works": that section came off
  // the homepage, and with it its menu entry. Any same-page hash link proves
  // the same two things.
  await page.getByRole("link", { name: "Ways to practice" }).click();
  await page.waitForTimeout(700);
  await expect(panel, "a same-page hash link left the menu open").toBeHidden();
  // The lock is handed back, not left on: the page has to scroll again.
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  expect(await page.evaluate(() => window.scrollY), "the link should still navigate").toBeGreaterThan(100);
  await ctx.close();
});
