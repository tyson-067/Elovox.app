import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL } from "@/lib/legal";

/* ---------------------------------------------------------------------------
   The Terms carry an arbitration agreement, a class-action waiver and an
   indemnity. Every one of those is a clause a user later says they never
   agreed to, and the only answer to that is a version string: this is what you
   accepted, this is what we published, compare them.

   That answer holds only while three things stay true, and none of the three
   is enforced by the type system:

     1. The sign-up screen and the Terms page print the SAME version. They used
        to hold two copies of the literal (app/terms/page.tsx and
        components/AuthForm.tsx), with nothing but a comment asking future
        edits to change both — so the version recorded at consent could drift
        from the version on the page, which is precisely the drift the version
        exists to rule out.
     2. The version agrees with the date printed at the top of the page. They
        are one event written two ways, and a reader who sees them disagree has
        no reason to trust either. The 30-day arbitration opt-out also runs
        from that date for anyone who already held an account.
     3. termsVersion really is an ISO date. app/terms/page.tsx publishes it
        straight into JSON-LD as `dateModified`, where anything else is invalid
        structured data.
   --------------------------------------------------------------------------- */

// Relative to the repo root, the way the other source-scanning suites read
// files: under jsdom `import.meta.url` is an http: URL, not a file: one.
const read = (p: string) => readFileSync(p, "utf8");

/**
 * "September 2, 2026" → "2026-09-02", without `new Date`. Parsing the human
 * string gives local midnight, so `toISOString()` on it returns the previous
 * day anywhere east of UTC — which would make this test pass or fail by
 * timezone rather than by content.
 */
function isoFromHumanDate(human: string): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const m = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(human.trim());
  expect(m, `LEGAL.termsUpdated is not "Month D, YYYY": ${human}`).not.toBeNull();
  const [, month, day, year] = m!;
  const index = months.indexOf(month);
  expect(index, `unknown month in LEGAL.termsUpdated: ${human}`).toBeGreaterThan(-1);
  return `${year}-${String(index + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

describe("terms version", () => {
  it("is a sortable ISO date, because JSON-LD dateModified publishes it raw", () => {
    expect(LEGAL.termsVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("names the same day as the date printed at the top of the page", () => {
    expect(LEGAL.termsVersion).toBe(isoFromHumanDate(LEGAL.termsUpdated));
  });

  it("is not re-declared as a literal in either place that displays it", () => {
    // The failure this pins is a silent one: a second copy compiles, renders,
    // and looks right, and only the day someone disputes what they accepted
    // does anyone find out the two numbers were different.
    for (const file of ["app/terms/page.tsx", "components/AuthForm.tsx"]) {
      const src = read(file);
      expect(src, `${file} declares its own version constant`).not.toMatch(
        /const\s+TERMS_VERSION\s*=/,
      );
      expect(src, `${file} hard-codes a version date`).not.toContain(
        `"${LEGAL.termsVersion}"`,
      );
      expect(src, `${file} should render LEGAL.termsVersion`).toContain(
        "LEGAL.termsVersion",
      );
    }
  });
});

describe("terms text", () => {
  // Whitespace-collapsed, because these are assertions about SENTENCES and the
  // JSX that holds them gets re-wrapped by the formatter on any edit — a
  // needle that straddles a line break would fail on a reflow that changed
  // nothing a reader would notice.
  const terms = read("app/terms/page.tsx").replace(/\s+/g, " ");

  it("does not promise courts for disputes it also sends to arbitration", () => {
    // The old "Governing law" section said every dispute would be heard by the
    // courts of the governing jurisdiction, full stop, while the section under
    // it compelled arbitration — a document that promises both is weaker than
    // one that promises either, so the two have to defer to each other in
    // writing.
    expect(terms).toContain("only covers what is left");
    expect(terms).toContain("subject to the rest of this section");
  });

  it("keeps the consumer carve-outs the arbitration clause is subject to", () => {
    // Small claims stays local, EU/UK consumers keep their own courts, and the
    // statutory floor is never excluded. Losing any of these silently is what
    // turns an enforceable clause into an unenforceable one.
    expect(terms).toContain("A small claims case can be brought wherever");
    expect(terms).toContain("does not let a company require arbitration before a dispute");
    expect(terms).toContain("Nothing here excludes liability that cannot legally be");
  });
});
