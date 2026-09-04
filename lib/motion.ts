// Elovox's motion policy, in one place.
//
// The site plays its motion for every visitor, including those whose OS asks
// for reduced motion: the hero entrance, the scrubbed report, the sideways
// card rail, the ladder climb, the parallax, the ticker, the waveform, the
// magnetic buttons. That is a deliberate product decision, made here rather
// than spread across a dozen `matchMedia` reads so it can be reversed by
// flipping one constant.
//
// WHAT THE PREFERENCE STILL GOVERNS, and why this is not simply "off":
//
// Some of this codebase's reduced-motion rules are not decoration switches,
// they are the thing that makes content VISIBLE. <Reveal> and <WordReveal>
// start at opacity 0 and are brought to 1 by an IntersectionObserver; the
// reduced-motion rules skip straight to 1 so a reader who asked for stillness
// never depends on an observer callback arriving. This repo has already
// shipped a permanently blank page from exactly that dependency, and
// tests/e2e/reduced-motion.spec.ts exists to keep it from happening twice —
// both of its tests assert that nothing is invisible, not that nothing moves.
//
// So the split is: CHOREOGRAPHY ignores the preference, CONTENT VISIBILITY
// still honours it. Turning the second half off would not give a
// reduced-motion visitor a livelier page, it would give them a blank one.
//
// The native iOS shell (lib/spring.ts, components/NativeRuntime.tsx) is
// deliberately untouched — this is a decision about the website.

/** Flip to `false` to hand the site back to the OS preference in full. */
export const MOTION_ALWAYS_ON = true;

/** Does this visitor want decorative motion suppressed?
 *
 *  Always `false` while MOTION_ALWAYS_ON is set. Call this ONLY for motion
 *  that is pure choreography — anything whose absence would leave content
 *  unreadable must keep reading the media query directly. */
export function reducedMotion(): boolean {
  if (MOTION_ALWAYS_ON) return false;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
