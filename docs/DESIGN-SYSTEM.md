# The design system

2026-08-25. What the tokens are, why they hold those values, and the rules that
keep the next pass from re-introducing what this one removed.

Two stylesheets, and the split matters:

- **`app/globals.css`** — the website, and the shared foundation. Everything
  here reaches the native shell too.
- **`app/native-theme.css`** — the iOS app only, every rule scoped under
  `html[data-native]`. Loaded *after* globals so it wins ties on source order
  without escalating specificity. The website never matches its rules.

---

## Why `@theme static`

Tailwind v4 tree-shakes theme variables it cannot see used as a utility. Most
of what this system adds — the durations, the containers, the shadow stack — is
read with `var()` from hand-written CSS, never as a class. Under a plain
`@theme` those variables **never reach `:root` at all**, and every rule
referencing one silently falls back to nothing.

That is not a hypothetical: the first version of this block emitted zero custom
properties and the failure was invisible until measured in the browser. Hence
`@theme static`, which forces emission.

**If you add a token that is only ever read via `var()`, it must live in the
`static` block.**

---

## Type

Replaces 265 arbitrary `text-[Npx]` values across 15 distinct sizes.
`text-[13px]` alone appeared **160 times** — a de-facto token nobody had named.

| Token | Size | Leading | Tracking | Use |
|---|---|---|---|---|
| `text-display` | fluid 2.75→4.5rem | 1.05 | −0.02em | hero only |
| `text-display-sm` | fluid 2.125→3rem | 1.1 | −0.02em | major section opener |
| `text-title` | fluid 1.9→3rem | 1.1 | −0.01em | page title |
| `text-h1` | 2.25rem | 1.15 | −0.02em | |
| `text-h2` | 1.75rem | 1.2 | −0.015em | section heading |
| `text-h3` | 1.375rem | 1.3 | −0.01em | |
| `text-h4` | 1.1875rem | 1.35 | −0.005em | card heading |
| `text-body-lg` | 1.125rem | 1.6 | — | lead paragraph |
| `text-body` | 1rem | 1.6 | — | body |
| `text-body-sm` | 0.9375rem | 1.5 | — | dense body |
| `text-label` | 0.8125rem | 1.5 | — | **UI label — the 160× one** |
| `text-caption` | 0.75rem | 1.5 | — | caption |
| `text-micro` | 0.6875rem | 1.5 | — | fine print |
| `text-kicker` | 0.8125rem | 1.4 | +0.03em, 600 | the uppercase section eyebrow |

**Why the four UI sizes are all 1.5.** Tailwind v4 already gives an arbitrary
`text-[Npx]` a `line-height: 1.5` — `text-[13px]` computes to 13px/19.5px. Using
1.5 made the migration of 236 call sites **exactly neutral**, so anything that
moved on screen afterwards was a real regression rather than a rounding
difference. Heading leading *was* tightened, because those sizes had about a
dozen call sites between them and 28px at 1.5 leading reads as an accident.

**`text-kicker` exists because the eyebrow was hand-written eight different ways
with five different tracking values** (0.03, 0.04, 0.06, 0.08em). One token, one
meaning.

---

## Colour

Unchanged by this pass, and deliberately so — the palette was already reasoned
and measured. The one thing worth restating, because it is the most common way
to break it:

`--color-accent` (`#ff6b35`) is **2.84:1** under white text, an AA failure.
`--color-accent-strong` (`#c2410c`) is 5.2:1 and is what every surface carrying
white text uses. They are two tokens on purpose. Do not "simplify" them into one.

Measured on this palette, against white:

| | ratio | verdict |
|---|---|---|
| `text-on-surface-variant/60` | 2.95:1 | fails — was every placeholder in the product |
| `text-on-surface-variant/80` | 4.71:1 | passes |
| `text-primary/70` | 4.07:1 | fails |
| `text-primary/75` | 4.61:1 | passes |
| `text-primary/80` | 5.23:1 | passes |
| `text-white/50` on the navy gradient | 2.77:1 | fails |
| `text-white/80` on the navy gradient | 4.58:1 | passes |

**An opacity below 80% on body-sized text is a contrast bug until measured
otherwise.** `/75` on Lapis is the one exception that clears it.

---

## Shape, elevation, layout

Radius and shadow tokens are **additive**. Tailwind's own `--radius-sm/md/lg`
are left alone because `rounded-lg` already carries 80 call sites, and silently
re-pointing it would restyle the product in one line.

```
--radius-field  0.625rem   --radius-chip 0.5rem
--radius-panel  1rem       --radius-pill 999px
--radius-card   0.75rem    (pre-existing)

--shadow-hairline  the card's real elevation: a hairline, not a value step
--shadow-lift-sm / --shadow-lift / --shadow-lift-lg
```

Shadow colour is Bleu Oxford, not black — a neutral-black shadow over a warm
ground reads as dirt.

```
--container-page   90rem    <main>'s cap
--container-wide   75rem
--container-prose  42rem
--container-narrow 35rem
--container-form   26.25rem

--space-page-y     clamp(2.5rem, 4vw, 4rem)      top/bottom of a page
--space-section    clamp(3.5rem, 5vw+1rem, 5.5rem)   between sections of the SAME kind
--space-section-lg clamp(5rem, 8vw+1rem, 8.5rem)     before a change of KIND
```

**The two section beats carry meaning, and picking between them is the whole
point.** Related sections sitting closer is what makes them read as a group; a
bigger pause before the story or the price is how a page says "different thing
now" without drawing a line. The landing page previously ran
112,112,112,80,80,80,80,80 — not a rhythm, a value that decayed once and never
recovered.

`--space-page-y` replaced six competing rhythms across thirteen sites
(`py-8/10/12` × `md:py-12/14/16`), each picked by feel.

`<main>` was full-bleed at every width, so past ~1600px the hero grid, every
card grid and the story deck kept stretching and the site read as a browser
window rather than a page. The cap is on `#main` and not an inner wrapper, so a
section that *wants* full bleed opts out with a negative margin rather than
every other section opting in.

---

## Motion

The web side had **no motion tokens at all**, which is how 64 distinct durations
and 54 uses of bare `ease` accumulated. The philosophy already existed — written
in a comment, in the native stylesheet, applying only to the app:

> everyday motion answers in under 300ms … exits are faster than entrances

These make it enforceable on both sides.

```
--ease-standard    cubic-bezier(.22,1,.36,1)   the house curve (already the
                                               most-used bezier before it had a name)
--ease-emphasized  cubic-bezier(.32,.72,0,1)   the sheet curve
--ease-exit        cubic-bezier(.4,0,1,1)
--ease-overshoot   cubic-bezier(.34,1.56,.64,1)

--dur-instant  90ms   press feedback
--dur-fast    120ms   hover, colour
--dur-micro   160ms   == --nv-t-micro
--dur-base    200ms   the most-used value in this codebase, by 2×
--dur-ui      260ms   == --nv-t-ui: sheets, screens, disclosure
--dur-slow    400ms   meters and progress fills
--dur-reveal  700ms   scroll reveals
--dur-exit    140ms   exits are faster than entrances, always
```

The scale was cut to match the values already in use rather than imposed on
them, so applying it was a consistency change and not a retiming.

**Keyframe animations keep their own curves.** Confetti gravity and the overshoot
on `word-in` were tuned individually; a house curve would flatten them.

### Gestures

`lib/spring.ts` — analytic damped-harmonic springs in Apple's *damping /
response* parameterisation, plus Apple's real momentum-projection function,
rubber-banding, and a windowed velocity tracker.

Hand-rolled rather than importing Framer Motion, for one reason specific to this
product: the iOS app is a WKWebView pointed at the deployed site, so every
kilobyte is paid again on every cold launch, on whatever connection the user has.

The solution is analytic, not a per-frame integrator, because an integrator's
result depends on the frame rate it happens to run at — and every iPhone this
ships to is 120Hz.

| | damping | response |
|---|---|---|
| reposition | 1.0 | 0.4 |
| drawer / sheet | 0.8 | 0.3 |
| snap-back (a correction, never a flourish) | 1.0 | 0.35 |

Bounce is reserved for motion the user's own gesture put momentum into.

---

## What the tests actually protect

```bash
npm run verify    # typecheck + lint + unit + build — the pre-push gate
npm run test:e2e  # builds, serves, and runs the browser gates
```

CI runs both on every push and pull request (`.github/workflows/ci.yml`).

**Unit (`tests/unit/`, Vitest).** Not coverage for its own sake — each file
pins a fact that has already been got wrong here:

| File | The bug it prevents |
|---|---|
| `contrast.test.ts` | Walks the real `.tsx` source, re-measures every `text-{token}/{opacity}` and fails under 4.5:1. It caught a live 3.91:1 the moment it was written. |
| `stylesheet-invariants.test.ts` | Fails if a reduced-motion block names a class nothing renders — the exact `.nv-rung-*` → `.nv-ring-*` drift that left two animations looping forever on the app's home screen. Also pins the final accessibility block to the bottom of the file. |
| `practice-catalog.test.tsx` | The `plan === null` third state. Renders the locked card during it and every subscriber sees a paywall flash on each cold load. |
| `spring.test.ts` | That the springs are analytic — the same settle at 60Hz and 120Hz — and that `stop()` returns live value *and* velocity, which is what makes interruption not jump. |
| `levels.test.ts`, `scoring.test.ts` | Threshold and monotonicity facts the report's bars and the XP receipt both depend on. |

**Billing and API guards.** The money path and the shared route guards, which
had no tests at all:

| File | The bug it prevents |
|---|---|
| `stripe-webhook.test.ts` | The two-phase idempotency claim. Chiefly that an **in-flight** claim returns **409, not 200** — a 200 tells Stripe to stop retrying, so an attempt that died on a function timeout is never retried, `done` is never set, and for `checkout.session.completed` that is a paying customer left on the free tier. Also: entitlement derived from the *customer* not the event's subscription, superseded subscriptions cancelled (a real subscriber was billed for two), the claim released when a handler throws, and that the signing secret never reaches a log line on a publicly-reachable branch. |
| `stripe-checkout.test.ts` | Unverified emails cannot subscribe; a customer holding any live subscription gets 409 rather than a second charge; the operator kill switch **fails closed**. |
| `billing-entitlement.test.ts` | That `isEntitled` (what the webhook writes) and `pastDueLapsed` (what the client trusts) agree — they take the same grace window in **different units**, seconds vs milliseconds, and the test pins both that and the 1ms boundary instant where they legitimately differ. |
| `api-guards.test.ts` | `clientIp` reads the **rightmost** `x-forwarded-for` entry. The leftmost is attacker-controlled, and reading it lets a caller rotate a header to defeat per-IP limiting — which is how a scripted caller once drove the paid Gemini pipeline. Also the daily-quota date clamp (a forged date must not mean infinite free attempts) and the body-size cap holding when `Content-Length` lies. |

**The analysis pipeline.** `lib/analyzeCore.ts` holds the pure core that used
to be module-private inside the 1,446-line route — a Next route file rejects
arbitrary exports, so those functions could not be exported in place and were
therefore untestable. They were moved **verbatim**, comments included, and the
extraction was verified byte-identical.

| File | The bug it prevents |
|---|---|
| `analyze-core.test.ts` | The numbers on the report. WPM over the real duration; the filler regex anchored at both ends (unanchored, "sold" and "somewhere" get reported to the user as filler); pauses measured word-gap not start-to-start (a drawn-out syllable is not a pause); and the transcript staying **verbatim** — the report promises the actual words spoken, never a paraphrase. Plus `calibrate` turning a non-finite score into 0: `Math.round(NaN)` is NaN and both `Math.max` and `Math.min` pass it through, so one bad dimension made `overall` NaN, which `awardXp` then added to the durable XP total — pinning the account to level 1 forever. And `fenced`, which neutralises a run of three-or-more double quotes so a speech topic cannot close the prompt fence and address the model directly. |
| `analyze-guards.test.ts` | Cost control. Every accepted request spends real money at AssemblyAI and Gemini. A missing `Content-Length` must 413 rather than reach `formData()` unbounded (Next route handlers have no default body limit — `bodySizeLimit` is Server-Actions-only), and the duration grace must hold: the client stops itself at exactly `MAX_RECORDING_SEC` and measures with `performance.now()`, so a full-length take reports 600.2 and a strict `> 600` refused it, losing ten minutes of recording. |

`tests/helpers/firestore-fake.ts` is deliberately *not* a general emulator. It
models buffered transaction writes specifically, because a fake that applied
writes immediately would let the two-phase claim pass even if the route wrote
outside the transaction — which is the property under test.

**E2E (`tests/e2e/`, Playwright, against a PRODUCTION build).** Dev serves
unminified CSS in a different order, and at least one bug here only appeared
once Tailwind had tree-shaken.

- **`app-store-gate.spec.ts`** — stamps `data-native` and asserts no price is
  reachable. This is the one that costs a rejected binary.
- **`reduced-motion.spec.ts`** — asserts nothing *disappears*. Note it calls
  `page.emulateMedia({ reducedMotion: "reduce" })` and then **checks the
  emulation took hold**: `test.use({ reducedMotion })` silently did nothing
  here, so the suite briefly asserted reduced-motion behaviour against a
  browser with motion on.
- **`responsive.spec.ts`** — 9 widths × 5 routes, plus a check that `<main>` is
  capped and centred rather than stretching.

**If you are adding a test, make it pin a fact somebody actually got wrong.**

## The iOS layer

**Dynamic Type.** iOS does not hand a WKWebView the user's text size. The one
thing that reflects it is the `-apple-system-body` shorthand — ask for it and
the computed `font-size` comes back as whatever the content size category says
body should be. `NativeRuntime` measures that at launch and on every resume
(the setting can change while backgrounded) and writes the ratio as
`--nv-type-scale`; the whole ramp in `native-theme.css` is `rem`, so one number
moves everything.

Clamped to 1.35, deliberately. The top accessibility sizes are ~3×, which does
not produce a readable app — it produces two words per line under the dock.
An app that claims full Dynamic Type and becomes unusable at the top of the
range has not supported it.

**Pull to refresh** (`lib/usePullToRefresh.ts`) reads `window.scrollY` and
translates `#main`, because these screens scroll the *document* — `#main` has no
overflow of its own, and attaching to a child that never scrolls is why a first
attempt appeared to do nothing. Everything mutable is a ref: putting
`refreshing` in the effect deps tore the listeners down mid-gesture.

**Dead CSS.** Sixteen `nv-*` classes were removed with a real PostCSS parse, not
string splicing — an earlier attempt spliced on character indices, clipped into
preceding comments and left stray fragments through the file. The three comments
that were genuinely lost are preserved under **RETIRED RULES, RETAINED LESSONS**
in `native-theme.css`: the 14px blur ceiling, why a theme-flipping token cannot
be a fill under white text, and why a gradient is only as good as its lightest
stop.

## The rules that keep this from rotting

1. **Reduced motion simplifies; it never hides.** Put `opacity: 0` in a `from`
   keyframe with a `backwards` fill, never on the element, so `animation: none`
   restores visibility by itself.

2. **A kill rule must out-specify what it kills.** A media query contributes no
   specificity. `.wr .wr-word > span` at (0,3,1) lost to
   `.wr-visible.text-gradient .wr-word > span` at (0,4,1), and the hero headline
   animated for every reader who had asked it not to.

3. **Accessibility goes at the BOTTOM of `native-theme.css`.** That file is nine
   appended redesign passes that work only by being last, and nothing in it uses
   `!important`. An earlier accessibility block wrote down this exact warning —
   and the next pass re-declared four translucent surfaces below it anyway.
   Append new work *above* the final block.

4. **Never rename a class without grepping the reduced-motion blocks.**
   `.nv-rung-*` → `.nv-ring-*` left two infinite animations running forever on
   the app's home screen.

5. **`.web-only` is the App Store firewall.** The iOS app loads the *same
   deployment* as the website, so any pricing or checkout affordance that loses
   its `web-only` marker becomes a Guideline 3.1.1 rejection. Check with
   `?native=1` after every change that touches a CTA.

6. **Fixed, non-`useId()` SVG gradient ids** in `FoxLogo` / `Biome` / `Backdrop`
   are required: two instances of the same mark must emit byte-identical defs or
   hydration desyncs.

---

## Shared page shells

`components/PracticeCatalogPage.tsx` backs `/interviews`, `/social` and `/own`.
Those were three copies of one page; the three-state card (premium / locked /
`plan === null` still-loading) was copied into each, which is three chances to
get the loading state wrong and one place it can now be wrong.

`/library` deliberately stays separate. It has an external store, per-item
replacement routing and an intro line, and a shell that served both would be
worse than two files. It passes its own card through `renderCard`.

**If you add a fourth catalog page, add props — not a copy.**

## Pulling components from a registry

`components.json` has eight registries wired — shadcn plus Magic UI, Aceternity,
Motion Primitives, React Bits, Kokonut, Origin UI and Cult UI:

```bash
npx shadcn@latest add @magicui/<name>
```

`cssVariables` is set to **false** on purpose. With it true, `shadcn init`
appended a stock grayscale `:root` block to the end of `globals.css`, and because
Tailwind v4 merges `@theme` in source order it won — `text-primary` compiled to
near-black and `bg-accent` to near-*white*, across ~310 call sites, and the
native dark theme died with it. With `cssVariables: false` a pulled component
arrives carrying literal utility classes that visibly need re-tokenising, which
is a much better failure mode than one that looks fine and isn't.

**Re-tokenise anything you pull before using it.** Registries are for shopping
ideas and hard primitives, not for importing another product's palette.
