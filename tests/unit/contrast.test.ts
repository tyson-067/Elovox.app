import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* ---------------------------------------------------------------------------
   Text opacity is a contrast bug until it is measured.
   ---------------------------------------------------------------------------
   Every `text-{token}/{n}` in this codebase blends the token toward the surface
   behind it, and the result is almost never what the number suggests: the
   placeholder colour used across every input in the product read /60 and
   measured 2.95:1 — not "a bit low", less than a third of the AA floor.

   This test walks the real source, finds every such usage, and re-measures it.
   Adding a new one below the floor fails CI instead of shipping.
   --------------------------------------------------------------------------- */

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const L = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hex = (h: string) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const over = (fg: number[], bg: number[], a: number) =>
  fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = L(a) > L(b) ? [L(a), L(b)] : [L(b), L(a)];
  return (hi + 0.05) / (lo + 0.05);
};

const WHITE = hex("#ffffff");
// The two grounds text actually sits on. The navy gradient runs Oxford ->
// Lapis -> Jazz -> Vista -> Amande, but background-size: 160% keeps the light
// end outside the box, so Jazz is the lightest ground white text meets in
// practice — and therefore the one to measure against.
const VIOLET = hex("#7663c4");
const GROUNDS: Record<string, number[]> = {
  surface: WHITE,
  navy: hex("#1a659e"),
  // The violet/10 pill on the team cards. A tint lifts the ground under the
  // text, which is precisely how a colour that passes on white stops passing.
  violetTint: VIOLET.map((c, i) => Math.round(c * 0.1 + WHITE[i] * 0.9)),
};
const TOKENS: Record<string, { color: number[]; ground: keyof typeof GROUNDS }> = {
  "on-surface-variant": { color: hex("#4a5068"), ground: "surface" },
  primary: { color: hex("#004e89"), ground: "surface" },
  white: { color: WHITE, ground: "navy" },
  violet: { color: VIOLET, ground: "surface" },
};

const AA = 4.5;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "ios", ".claude", "tests"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("text contrast", () => {
  const files = sourceFiles(process.cwd());

  it("finds source to check (guards against the walker silently matching nothing)", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("every text-{token}/{opacity} in the product clears WCAG AA", () => {
    const failures: string[] = [];
    const re = /\btext-(on-surface-variant|primary|white|violet)\/(\d{1,3})\b/g;

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) {
        const [full, token, pct] = m;
        const spec = TOKENS[token];
        const bg = GROUNDS[spec.ground];
        const r = ratio(over(spec.color, bg, Number(pct) / 100), bg);
        if (r < AA) {
          failures.push(
            `${file.replace(process.cwd() + "/", "")}: ${full} = ${r.toFixed(2)}:1 on ${spec.ground}`
          );
        }
      }
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  });

  it("the accent split is real — the bright accent still fails under white", () => {
    // --color-accent and --color-accent-strong are two tokens on purpose. If
    // someone "simplifies" them into one, this is the fact that gets lost.
    expect(ratio(hex("#ff6b35"), WHITE)).toBeLessThan(AA);
    expect(ratio(hex("#c2410c"), WHITE)).toBeGreaterThanOrEqual(5);
  });

  it("violet-strong exists because plain violet fails on its own tint", () => {
    // Same shape as the accent/accent-strong split, one hue over. If someone
    // "simplifies" these into one token, this is the fact that gets lost.
    const tint = GROUNDS.violetTint;
    expect(ratio(VIOLET, WHITE)).toBeGreaterThanOrEqual(AA);      // fine on white
    expect(ratio(VIOLET, tint)).toBeLessThan(AA);                  // NOT fine on the pill
    expect(ratio(hex("#6a57bc"), tint)).toBeGreaterThanOrEqual(AA); // which is why -strong exists
    expect(ratio(hex("#6a57bc"), WHITE)).toBeGreaterThanOrEqual(AA);
  });

  it("the measurement itself is right", () => {
    // Sanity-check the maths against known values, so a broken formula cannot
    // make every other assertion in this file pass vacuously.
    expect(ratio(hex("#000000"), WHITE)).toBeCloseTo(21, 1);
    expect(ratio(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(ratio(over(hex("#4a5068"), WHITE, 0.6), WHITE)).toBeCloseTo(2.95, 1);
  });
});
