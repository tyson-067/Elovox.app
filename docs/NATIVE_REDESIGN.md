# The native redesign

2026-08-03. The full record of the ground-up UI rebuild of the iOS shell.
The website is untouched by all of it — every rule is scoped to
`html[data-native]`.

## Why a rebuild

Two earlier passes (the Booth identity, then the quiet-minimal pass) restyled
the website's screens under the shell via cascade overrides. The user's
verdict: still reads as adjusted web pages, not an app. This pass replaces the
approach — screens are now COMPOSED from a native design system, not
overridden into shape.

## The system

- **Tokens**: `app/native-theme.css`. One accent (Felix orange: 50/100/500/
  600/700, with 700 = the AA-verified `#c2410c` under white text), neutral
  ink ramps, two designed modes (light `#FAFAFA` ground; dark on the brand's
  `#0D0A20` with elevated `#16132C` cards), the system font stack, the iOS
  type scale (34/22/17/17/15/13/11), 4pt spacing, radii 14/12/12/999 with
  `corner-shape: squircle` where supported, liquid-glass material for bars,
  dock and sheets, spring easings. The legacy `--color-*` names are re-pointed
  at the system (both modes), which is what pulls every SHARED component into
  the new palette without touching web markup.
- **Primitives**: `components/native/ui.tsx` — NvSectionHeader, NvGroup,
  NvRow, NvButton, NvChip, NvStat, NvEmpty, NvSheet (+ NvChevron). Native
  screens compose these; hex values or bare px in a native component = bug.
- **Precedent**: pages keep ALL data/logic and pass props; `Native*`
  components are pure presentation behind `useIsNative()`; web markup gets
  `native-hide`. (`NativeToday` is the reference implementation.)

## Screens

- **Today** (`components/NativeToday.tsx`): Daily Minute hero first (caption,
  title, one-liner, attempt DOTS, the screen's one accent button), then the
  stat strip (Felix + level meter + streak numeral), then the Tape, then
  "More ways to practice" as an inset grouped list with single lock glyphs
  (`NativeSections.tsx`).
- **Progress** (`components/native/NativeProgress.tsx`): Whoop-style — big
  score numeral + trend delta, sparkline, six metric meters, stat row, recent
  sessions as rows; designed empty state.
- **Report** (`components/native/NativeReport.tsx`): dial hero (arc draws),
  six metric meters, the marked-up transcript in a reading card, stat grid.
- **Library ×5** (`components/native/NativeLibraryList.tsx`): calm grouped
  rows; locked = reduced opacity + one lock glyph; no upsell, no prices
  (App Store 3.1.1).
- **Account** (`components/native/NativeAccount.tsx`): inset grouped lists
  only; email/password/delete flows in sheets; appearance as a segmented
  control; the app's first SIGN OUT row.
- **Practice**: goal picker as a two-column chip grid; recording is a
  full-screen dark takeover (`nv-takeover`) with a huge tabular timer and a
  ring that fills with elapsed time.
- **Chrome** (`NativeShell` + theme CSS): 34pt large title in ink, glass bar
  and dock, accent-tinted active tab, the record control seated as a clean
  circle (ring/pulse only while recording).

## The signature

THE TAPE stays: fourteen days as voice bars, in the app icon's grammar.
Binding rule unchanged (`.voxline` in globals.css): bars only for what the
voice produced; static instances only Felix's chest and the Progress icon.

## Known trade-offs

- The booth's lamp gradient and `#080617` ground are retired; dark now uses
  the brief's `#0D0A20`/`#16132C`/`#1E1A38` layers. The "Booth" name stays on
  the Account toggle.
- `corner-shape: squircle` is progressive enhancement; other engines get
  plain radii.
- Recording takeover is dark in both themes by design (a booth is dark).
