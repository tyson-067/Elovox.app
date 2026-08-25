import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const NATIVE = readFileSync("app/native-theme.css", "utf8");
const GLOBALS = readFileSync("app/globals.css", "utf8");

function markup(dir = process.cwd(), out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "ios", ".claude", "tests"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) markup(p, out);
    else if (/\.(tsx|ts)$/.test(p)) out.push(p);
  }
  return out;
}
const SOURCE = markup().map((f) => readFileSync(f, "utf8")).join("\n");

/** CSS with comments removed — a comment that mentions `.nv-foo` is prose,
 *  not a selector, and matching it makes this file fail on its own footnotes. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Bodies of every @media block whose condition matches. */
function mediaBodies(css: string, condition: RegExp): string[] {
  const out: string[] = [];
  const re = /@media([^{]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (!condition.test(m[1])) continue;
    let depth = 1;
    let i = re.lastIndex;
    while (depth && i < css.length) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out;
}

describe("reduced motion", () => {
  const blocks = [
    ...mediaBodies(NATIVE, /prefers-reduced-motion/),
    ...mediaBodies(GLOBALS, /prefers-reduced-motion/),
  ];

  it("has blocks in both stylesheets", () => {
    expect(blocks.length).toBeGreaterThan(5);
  });

  it("only silences classes that something actually renders", () => {
    // THE bug this file exists for. The LADDER PASS renamed .nv-rung-halo to
    // .nv-ring-halo and .nv-rung-felix to .nv-ring-felix; the reduced-motion
    // block kept the OLD names, so on the app's HOME SCREEN a ring pulsed
    // every 3s and Felix bobbed every 3.4s, forever, for a reader who had
    // switched Reduce Motion on. Nothing failed. Nothing looked wrong in the
    // diff. A rule pointing at a class nobody renders is a rule that does
    // nothing, and this is the only thing that can notice.
    const dead: string[] = [];
    for (const body of blocks) {
      for (const cls of new Set(stripComments(body).match(/\.nv-[a-z0-9-]+/g) ?? [])) {
        const bare = cls.slice(1);
        // Referenced from markup, or defined outside this block as a real rule?
        const inMarkup = new RegExp(`\\b${bare}\\b`).test(SOURCE);
        if (!inMarkup) dead.push(cls);
      }
    }
    expect(
      dead,
      `\nThese are silenced under Reduce Motion but nothing renders them — ` +
        `either the class was renamed and this block was not updated, or the ` +
        `rule is dead:\n  ${dead.join("\n  ")}\n`
    ).toEqual([]);
  });

  it("never resolves an element to opacity 0 as its ONLY instruction", () => {
    // Reduced motion must SIMPLIFY, not HIDE. Every entrance animation here
    // puts its opacity:0 in a `from` keyframe with a backwards fill precisely
    // so `animation: none` restores visibility by itself. A block that sets
    // opacity:0 directly is deleting content for the readers who most need it.
    for (const body of blocks) {
      const rules = stripComments(body).split("}");
      for (const rule of rules) {
        if (/opacity:\s*0(\s|;|$)/.test(rule)) {
          // Allowed only where the element is decorative AND the rule says so.
          expect(
            rule,
            `A reduced-motion rule sets opacity: 0 directly:\n${rule}\n`
          ).toMatch(/confetti|spark|halo|glow|orb/i);
        }
      }
    }
  });
});

describe("native-theme.css structure", () => {
  it("keeps the final accessibility block at the very bottom", () => {
    // Nothing in this file uses !important, so every accommodation is won on
    // SOURCE ORDER. An earlier accessibility block wrote down this exact
    // warning and asked future passes to add themselves to it — and the next
    // pass re-declared four translucent surfaces below it anyway, silently
    // taking them back out of the accommodation.
    const marker = NATIVE.indexOf("THE LAST WORD ON ACCESSIBILITY");
    expect(marker, "the final accessibility block is missing").toBeGreaterThan(0);

    const after = NATIVE.slice(marker);
    // Only reduced-motion / reduced-transparency work and touch targets may
    // follow it. Anything else means a pass appended below the block.
    const strayGlass = /backdrop-filter:\s*blur\((?!0)/.test(
      after.replace(/@media[^{]*prefers-reduced[^}]*\{[\s\S]*?\n\}/g, "")
    );
    expect(strayGlass, "a translucent surface was declared BELOW the final block").toBe(false);
  });

  it("covers every blurred floating surface under reduced transparency", () => {
    const rt = mediaBodies(NATIVE, /prefers-reduced-transparency/).join("\n");
    for (const surface of ["native-bar", "native-dock", "nv-ladder-bar", "body::before"]) {
      expect(rt, `${surface} is not made opaque under reduced transparency`).toContain(surface);
    }
  });
});

describe("design tokens", () => {
  it("emits var()-only tokens from @theme static, or they never reach :root", () => {
    // Tailwind v4 tree-shakes theme variables it cannot see used as a utility.
    // Durations, containers and the shadow stack are read with var() from
    // hand-written CSS, so under a plain @theme they are dropped entirely and
    // every rule referencing one silently falls back to nothing.
    const staticBlock = GLOBALS.slice(GLOBALS.indexOf("@theme static"));
    for (const token of ["--dur-base", "--ease-standard", "--container-page", "--shadow-lift", "--space-section"]) {
      expect(staticBlock, `${token} must live in the @theme static block`).toContain(token);
    }
  });

  it("still ships both halves of the accent and violet splits", () => {
    for (const t of ["--color-accent:", "--color-accent-strong:", "--color-violet:", "--color-violet-strong:"]) {
      expect(GLOBALS).toContain(t);
    }
  });
});
