import { expect, test } from "@playwright/test";

/* ---------------------------------------------------------------------------
   App Store guideline 3.1.1.
   ---------------------------------------------------------------------------
   The iOS app is not a bundled build — capacitor.config.ts points a WKWebView
   at this deployment. Whatever ships here is inside the app within seconds,
   with no store review and no rollback. So a pricing CTA that loses its
   `web-only` marker is not a styling bug, it is a rejected binary.

   `data-native` is the attribute the shell stamps on <html> before first
   paint. Setting it here is exactly what the app does.
   --------------------------------------------------------------------------- */

const MONEY = /\$\s?\d|\d+\s?USD|\/\s?(?:year|month|week)\b|per (?:year|month|week)/;
const ROUTES = ["/", "/pricing", "/about", "/terms", "/login", "/signup"];

for (const route of ROUTES) {
  test(`no price is reachable inside the shell on ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.evaluate(() => document.documentElement.setAttribute("data-native", "1"));

    const visibleMoney = await page.evaluate((src) => {
      const re = new RegExp(src, "");
      const hits: string[] = [];
      document.querySelectorAll("body *").forEach((el) => {
        if (el.children.length) return;
        const t = (el.textContent || "").trim();
        if (!t || !re.test(t)) return;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.05 && (r.width > 0 || r.height > 0)) {
          hits.push(t.slice(0, 60));
        }
      });
      return hits;
    }, MONEY.source);

    expect(visibleMoney, `priced text visible with data-native on ${route}`).toEqual([]);
  });
}

test("every web-only element is hidden once the shell stamps data-native", async ({ page }) => {
  await page.goto("/pricing");

  const before = await page.locator(".web-only").count();
  expect(before, "/pricing should carry web-only markers").toBeGreaterThan(0);

  // Prices must be visible in a BROWSER — otherwise this test would pass on a
  // page that simply lost its pricing, which is the opposite failure.
  const shownInBrowser = await page.evaluate(() =>
    [...document.querySelectorAll("body *")].filter((el) => {
      if (el.children.length) return false;
      return /\$\s?\d/.test((el.textContent || "").trim());
    }).length
  );
  expect(shownInBrowser, "prices should be visible to a browser").toBeGreaterThan(0);

  await page.evaluate(() => document.documentElement.setAttribute("data-native", "1"));
  const stillVisible = await page.locator(".web-only").evaluateAll(
    (els) => els.filter((e) => getComputedStyle(e).display !== "none").length
  );
  expect(stillVisible, "a web-only element is still displayed inside the shell").toBe(0);
});
