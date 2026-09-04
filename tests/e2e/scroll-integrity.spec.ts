import { expect, test } from "@playwright/test";

/* Two bugs that were reported from a phone, and a third found looking for
   them. All three are scroll-position-dependent, which is why none of them
   survived a desktop screenshot and all three shipped.

   The shared shape: something on the page is a function of scrollY, and
   nothing checked what that function did OUTSIDE the range where it was
   supposed to matter. */

const PHONE = { width: 390, height: 844 };


/** Walk the page rather than jumping, so scroll handlers and observers get the
 *  frames they need — a `scrollTo(0, bottom)` outruns both and measures a page
 *  mid-update, which is exactly the state a real flick produces and a real
 *  assertion should not. */
async function walkToBottom(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const de = document.documentElement;
    for (let y = 0; y <= de.scrollHeight; y += 160) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 8));
    }
    window.scrollTo(0, de.scrollHeight);
    await new Promise((r) => setTimeout(r, 350));
  });
}

test.describe("the page is the height it says it is", () => {
  /* The reported bug: flick to the bottom of the homepage on a phone and the
     footer sits ~1,150px above the end of the document, with nothing under it.
     A beat later the page silently shortens and the gap closes.

     Cause: components/Parallax.tsx offset an element by its distance from the
     centre of the viewport times a speed, with no bound. Near the bottom of a
     12,000px page that distance is ~9,800px, so a 144px decorative orb was
     translated 1,959px DOWN — and vertical overflow from an absolutely
     positioned descendant propagates to the document. (`overflow-x: clip` on
     html covers the sideways case; there is no vertical equivalent that
     doesn't also kill page scrolling.)

     The document height is therefore the assertion: if it changes as you
     scroll, something is drawing outside the page and the scrollbar is lying
     about where the end is. */
  for (const route of ["/", "/about", "/pricing"]) {
    test(`${route} does not change height as you scroll it`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(700);

      const atTop = await page.evaluate(() => document.documentElement.scrollHeight);
      await walkToBottom(page);
      const atBottom = await page.evaluate(() => document.documentElement.scrollHeight);

      expect(
        Math.abs(atTop - atBottom),
        `document height moved between the top (${atTop}px) and the bottom (${atBottom}px) of ${route}`
      ).toBeLessThan(24);
    });
  }

  test("nothing is drawn below the footer", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    // Deliberately a JUMP, not a walk: this is the reported gesture. The
    // scroll handlers have not run yet, and the page must already be honest.
    const dead = await page.evaluate(() => {
      const de = document.documentElement;
      window.scrollTo(0, de.scrollHeight);
      const f = document.querySelector("footer")!.getBoundingClientRect();
      return Math.round(window.innerHeight - f.bottom);
    });
    expect(dead, "blank space under the footer after a flick to the bottom").toBeLessThan(24);
  });
});

/* The level ladder's two tests lived here, and they are gone with the section
   they guarded: "Twelve levels, earned out loud" was taken off the homepage,
   so `.ladder-name` and `.ladder-rail` match nothing on `/` and both tests
   failed on a selector rather than on a regression.

   components/LevelLadder.tsx is still in the tree, unrendered. If it is ever
   put back on a page, restore these from git history rather than writing new
   ones: they pin the property that mattered (every level legible and reachable
   by the end of the climb) rather than the mechanism, which is why they
   survived the section's last rewrite. */

test.describe("a live recording can always be stopped", () => {
  /* Not reported — found looking for the two above, and the worst of the
     three. On a phone the practice page is ~2,200px tall and the recorder sits
     in the middle of it, so scrolling up to re-read the three points you are
     being timed on (which is what the page tells you to do) took the Stop
     button and the countdown off screen with no second copy of either.

     components/RecordingDock.tsx docks both whenever the inline control is out
     of view. */

  /* The everyday half of the same problem: before a take, ~1,450px of brief,
     instructions and Impact Modes sit between the top of the page and the
     record button, so the primary action of the product is a long scroll down
     its main flow. Above `lg` the stage sticks and this never arises; below it
     the page stacks. The dock carries the idle face too, and this test starts
     a take without ever scrolling to the real button. */
  test("a take can be started without hunting for the button", async ({ page, context }) => {
    await context.grantPermissions(["microphone"]);
    await page.setViewportSize(PHONE);
    await page.goto("/practice?daily=1");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1400);

    // Wait for the control through a locator (which auto-waits) before
    // measuring it with raw DOM — a bare evaluate() has no such patience and
    // read `undefined` off a page that had not finished rendering.
    const inline = page.getByRole("button", { name: /start recording/i }).first();
    await inline.waitFor({ state: "attached" });

    // Never scrolled: the real control is far below the fold.
    const box = await inline.boundingBox();
    const vh = page.viewportSize()!.height;
    const inlineOffScreen = !!box && box.y > vh;
    expect(inlineOffScreen, "this test is pointless if the button is already visible").toBe(true);

    const dock = page.locator(".recording-dock");
    await expect(dock).toHaveClass(/is-docked/);
    await expect(dock.locator("button")).toHaveText(/record/i);

    await dock.locator("button").click();
    await page.waitForTimeout(1500);

    await expect(dock.locator("button"), "the dock must flip to Stop once the take is live")
      .toHaveText(/stop/i);
    const live = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) =>
        /stop recording/i.test(b.getAttribute("aria-label") ?? "")
      )
    );
    expect(live, "tapping the dock did not actually start a take").toBe(true);
  });

  test("the dock gets out of the way when the real transport is readable", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/practice?daily=1");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1400);

    await page
      .getByRole("button", { name: /start recording/i })
      .first()
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    // Two record buttons on one screen is the failure this guards against.
    await expect(page.locator(".recording-dock")).not.toHaveClass(/is-docked/);
  });

  test("stop and the clock stay on screen wherever you scroll", async ({ page, context }) => {
    await context.grantPermissions(["microphone"]);
    await page.setViewportSize(PHONE);
    await page.goto("/practice?daily=1");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1200);

    const record = page.getByRole("button", { name: /start recording/i }).first();
    await record.scrollIntoViewIfNeeded();
    await record.click();
    await page.waitForTimeout(1200);

    for (const where of ["top", "bottom"] as const) {
      await page.evaluate((w) => {
        window.scrollTo(0, w === "top" ? 0 : document.documentElement.scrollHeight);
      }, where);
      await page.waitForTimeout(500);

      const reachable = await page.evaluate(() => {
        const onScreen = (el: Element) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return (
            r.top < window.innerHeight &&
            r.bottom > 0 &&
            cs.visibility !== "hidden" &&
            parseFloat(cs.opacity) > 0.05
          );
        };
        const stops = [...document.querySelectorAll("button")].filter(
          (b) =>
            b.offsetParent !== null &&
            /stop|finish/i.test(`${b.textContent} ${b.getAttribute("aria-label") ?? ""}`)
        );
        const clocks = [...document.querySelectorAll("*")].filter(
          (e) => !e.children.length && /^\d?\d:\d\d$/.test((e.textContent || "").trim())
        );
        return { stop: stops.some(onScreen), clock: clocks.some(onScreen) };
      });

      expect(reachable.stop, `no way to stop the take from the ${where} of the page`).toBe(true);
      expect(reachable.clock, `no countdown visible from the ${where} of the page`).toBe(true);
    }
  });
});
