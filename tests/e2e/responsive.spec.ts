import { expect, test } from "@playwright/test";

/* Horizontal overflow is cheap to introduce and invisible on the desktop the
   change was written on. 320 is the narrowest phone still in use; 1920 catches
   the opposite failure, where a page stops being laid out and starts being a
   browser window. */

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const ROUTES = ["/", "/pricing", "/about", "/terms", "/login"];

for (const route of ROUTES) {
  test(`no horizontal overflow on ${route}`, async ({ page }) => {
    const failures: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) {
        const culprit = await page.evaluate(() => {
          let max = 0, who = "";
          document.querySelectorAll("body *").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.right > max) { max = r.right; who = el.tagName + "." + el.className; }
          });
          return who;
        });
        failures.push(`${width}px overflows by ${over}px — widest: ${culprit}`);
      }
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  });
}

test("content is capped, not stretched, on a large display", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  const main = page.locator("#main");
  const box = await main.boundingBox();
  expect(box, "#main should exist").not.toBeNull();
  // <main> used to be full-bleed at every width, so past ~1600px the hero grid
  // and the story deck simply kept stretching.
  expect(box!.width).toBeLessThan(1920);
  expect(Math.abs(box!.x - (1920 - box!.width) / 2)).toBeLessThan(2); // centred
});
