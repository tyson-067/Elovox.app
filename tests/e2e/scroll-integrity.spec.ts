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

test.describe("the level ladder", () => {
  /* The reported bug: "the chart thingy doesn't fully load". Every rung was
     wrapped in <Reveal>, which flips on an IntersectionObserver — and an
     observer measures against the VIEWPORT, so rungs sitting off the right
     edge of a horizontal scroller never intersected, never flipped, and stayed
     at opacity 0 for the life of the page. Eight of the twelve levels were
     simply not on the homepage at iPhone width.

     The replacement (components/LevelLadder.tsx) is driven by scroll POSITION,
     so there is no callback that can fail to arrive. These tests pin the
     property that matters — every level is legible by the end — rather than
     the mechanism, so the next redesign of this section inherits the check. */

  test("all twelve levels become legible on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(700);

    const names = page.locator(".ladder-name");
    await expect(names).toHaveCount(12);

    // Scroll to the end of the ladder's own runway, which is where the climb
    // completes. With no runway (a rail that fits) a viewport of scrolling
    // past the section does the same job.
    await page.evaluate(async () => {
      const sec = document.querySelector(".ladder-rail")!.closest("section")!;
      const spacer = sec.lastElementChild as HTMLElement;
      const runway = spacer.style.height ? parseFloat(spacer.style.height) : window.innerHeight;
      const base = sec.getBoundingClientRect().top + window.scrollY - 72;
      // Stepped by integer twentieths, not by `f += 0.05`: accumulating 0.05
      // in binary overshoots 1 on the twenty-first pass, so that loop stops at
      // 0.95 — and the twelfth rung sits at 95.83% of the rail, so it is still
      // legitimately dark there. The test would have failed on a working
      // ladder.
      for (let i = 0; i <= 20; i++) {
        window.scrollTo(0, base + (i / 20) * runway);
        await new Promise((r) => setTimeout(r, 20));
      }
      await new Promise((r) => setTimeout(r, 300));
    });

    const faded = await names.evaluateAll((els) =>
      els
        .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.9)
        .map((el) => (el.textContent || "").trim())
    );
    expect(faded, "levels still dimmed after the whole climb").toEqual([]);
  });

  test("every level is reachable, not just lit", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(700);
    // The rail is wider than the phone by design; what must not happen is the
    // rail's BOX staying at the window's width while its rungs overflow it,
    // which is what left the connecting line drawn only under the first four.
    const rail = await page.locator(".ladder-rail").evaluate((el) => ({
      box: Math.round(el.getBoundingClientRect().width),
      content: el.scrollWidth,
      line: Math.round(el.querySelector(".ladder-line")!.getBoundingClientRect().width),
    }));
    expect(rail.box, "the rail's box must cover its rungs").toBe(rail.content);
    expect(rail.line, "the rail line must run the length of the ladder").toBeGreaterThan(
      rail.content * 0.9
    );
  });
});

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
