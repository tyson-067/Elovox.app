import { expect, test } from "@playwright/test";

/* ---------------------------------------------------------------------------
   Reduced motion must SIMPLIFY, never HIDE.
   ---------------------------------------------------------------------------
   Two separate bugs shipped here. One: the hero headline kept scatter-
   assembling because its kill rule was specificity (0,3,1) against a live rule
   at (0,4,1), and a media query adds none. Two: on the app's home screen a
   ring pulsed and Felix bobbed forever, because a class rename left the
   accommodation pointing at names nothing rendered.

   The dangerous direction is the opposite one, though: this codebase has
   already shipped a permanently-blank page from an opacity:0 reveal system.
   Killing an animation that is the only thing bringing an element to opacity 1
   deletes content for exactly the readers who needed it kept.
   --------------------------------------------------------------------------- */

/* page.emulateMedia, NOT test.use({ reducedMotion }).
   The `use` form silently did nothing here — a probe inside the test reported
   matchMedia("(prefers-reduced-motion: reduce)").matches === false, so the
   suite was asserting reduced-motion behaviour against a browser that had
   motion switched ON, and "failing" on words that were legitimately mid-reveal.
   A test that does not actually enter the state it claims to test is worse
   than no test: it fails for the wrong reason today and passes for the wrong
   reason tomorrow. Every test below asserts the emulation took hold first. */

const ROUTES = ["/", "/pricing", "/about", "/terms"];

for (const route of ROUTES) {
  test(`nothing disappears on ${route} with Reduce Motion on`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(route);
    expect(
      await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
      "reduced motion emulation did not take hold"
    ).toBe(true);
    await page.waitForLoadState("networkidle");
    // Scroll the whole page so every IntersectionObserver has had its chance.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise(requestAnimationFrame);
      }
      window.scrollTo(0, 0);
    });

    const hidden = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("#main *, header *, footer *").forEach((el) => {
        const t = (el.textContent || "").trim();
        // length < 2, not < 4. A threshold of 4 skips "The" — and a debug
        // script with exactly that filter is why a genuine opacity-0 word went
        // unnoticed while this suite was being written. Short words are still
        // content; only single characters (decorative glyphs, punctuation
        // nodes) are worth skipping.
        if (!t || t.length < 2 || el.children.length > 0) return;
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) return;
        if (el.closest('[aria-hidden="true"]') || el.classList.contains("sr-only")) return;
        const cs = getComputedStyle(el);
        if (parseFloat(cs.opacity) < 0.05 || cs.visibility === "hidden") {
          out.push(`${el.tagName}.${el.className} — "${t.slice(0, 40)}"`);
        }
      });
      return out;
    });

    expect(hidden, `content hidden under Reduce Motion on ${route}`).toEqual([]);
  });
}

test("the hero headline is readable, not mid-animation, under Reduce Motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
    "reduced motion emulation did not take hold"
  ).toBe(true);

  // Every word, including the ones below the fold whose IntersectionObserver
  // has never fired. That is the whole point: with motion off, visibility must
  // not depend on an observer callback arriving. This codebase has already
  // shipped a permanently blank page from exactly that dependency.
  const words = page.locator(".wr .wr-word > span");
  const count = await words.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(words.nth(i)).toHaveCSS("opacity", "1");
  }
});
