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

test.describe("page bottom", () => {
  /* Every page used to add its own trailing pb-20/pb-24 on top of the footer's
     own top margin, stacking 144-160px of dead space at the bottom of the site.
     It read as a rendering fault, not as spacing — which is exactly how it was
     reported. The footer owns that gap now; pages must not add bottom padding. */
  for (const route of ["/", "/about", "/pricing", "/terms"]) {
    for (const width of [390, 1280]) {
      test(`no dead space above the footer on ${route} @${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 600) {
            window.scrollTo(0, y);
            await new Promise(requestAnimationFrame);
          }
          window.scrollTo(0, 0);
        });

        const gap = await page.evaluate(() => {
          const main = document.querySelector("#main")!;
          const footer = document.querySelector("footer")!;
          const footerTop = footer.getBoundingClientRect().top + window.scrollY;
          let deepest = 0;
          main.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            // checkVisibility, not just a non-zero box. Chrome hides the
            // children of a CLOSED <details> with content-visibility rather
            // than display:none, so /pricing's five collapsed FAQ answers
            // still measure a few hundred px tall each while painting
            // nothing. Their phantom boxes hang below the questions, and the
            // longest one was landing 2px above the footer, failing a test
            // about visible spacing over text no reader can see. The
            // assertion is unchanged; this only stops counting content that
            // is not rendered.
            const shown = el.checkVisibility({
              contentVisibilityAuto: true,
              opacityProperty: true,
              visibilityProperty: true,
            });
            if (shown && r.height > 0 && r.width > 0 && (el.textContent || "").trim()) {
              deepest = Math.max(deepest, r.bottom + window.scrollY);
            }
          });
          return Math.round(footerTop - deepest);
        });

        // One --space-section beat, not two stacked ones. 96 leaves room for the
        // token's fluid ceiling without tolerating a second helping of padding.
        expect(gap, `${gap}px between the last content and the footer`).toBeLessThanOrEqual(96);
        expect(gap, "the footer should not be flush against the content").toBeGreaterThan(8);
      });
    }
  }

  test("nothing renders below the footer", async ({ page }) => {
    await page.goto("/");
    const below = await page.evaluate(() => {
      const footer = document.querySelector("footer")!;
      const fb = footer.getBoundingClientRect().bottom + window.scrollY;
      return document.documentElement.scrollHeight - fb;
    });
    expect(below).toBeLessThanOrEqual(2);
  });
});
