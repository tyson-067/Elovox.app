/**
 * Springs and gesture physics, in Apple's parameterisation.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The shell already had spring-shaped MOTION — `--nv-spring` and friends in
 * native-theme.css are real `linear()` approximations, not cubic-bezier fakes,
 * and they look right. What they cannot do is be INTERRUPTED. A CSS animation
 * plays from a fixed start to a fixed end on a fixed clock; if the user grabs
 * a sheet mid-close, the browser has no notion of "continue from where you
 * actually are, at the speed you were actually going". Interruptibility is the
 * one property that separates an app that responds from an app that plays back,
 * and it is the reason every gesture in this file is driven from JS instead.
 *
 * WHY NOT A LIBRARY
 * -----------------
 * Framer Motion would do this well, and it was briefly a dependency here. But
 * the iOS app is a WKWebView pointed at the deployed site, not a bundled app —
 * every kilobyte is paid again on every cold launch, over whatever connection
 * the user has. This file is what we actually need out of that library, and it
 * ships as part of a chunk we were already sending.
 *
 * PARAMETERS
 * ----------
 * Apple deliberately retired mass/stiffness/damping in favour of two numbers a
 * designer can reason about, and this uses the same two:
 *
 *   damping   1.0 = critically damped, settles with no overshoot. Below 1.0
 *             overshoots and oscillates. This is a RATIO, not a coefficient.
 *   response  roughly how long the value takes to arrive, in seconds. It is
 *             not a duration — a spring has no duration — it is the period of
 *             the underlying oscillator.
 *
 * House defaults follow Apple's own shipped values: reposition 1.0/0.4,
 * drawers and sheets 0.8/0.3. Bounce is reserved for motion the user's own
 * gesture put momentum into. A menu that merely appeared should not overshoot.
 *
 * The solution below is ANALYTIC rather than a per-frame integrator. That
 * matters for correctness, not elegance: an integrator's result depends on the
 * frame rate it happened to run at, so the same spring settles differently on
 * a 60Hz and a 120Hz display — and every iPhone this ships to is 120Hz.
 */

export type SpringOptions = {
  from: number;
  to: number;
  /** px/s at the moment of handoff. Pass the gesture's release velocity here. */
  velocity?: number;
  /** 1 = no overshoot. ~0.8 for anything the user flicked. */
  damping?: number;
  /** Seconds. Lower is snappier. */
  response?: number;
  onFrame: (value: number, velocity: number) => void;
  onRest?: () => void;
  /** Distance from target that counts as arrived. Pixels. */
  restDistance?: number;
  /** Speed below which we stop caring. px/s. */
  restVelocity?: number;
};

export type SpringHandle = {
  /** Halt immediately. Returns the value/velocity it was at, for handoff. */
  stop: () => { value: number; velocity: number };
  /** True until the spring rests or is stopped. */
  readonly running: boolean;
};

/**
 * Animate `from` -> `to` as a damped harmonic oscillator.
 *
 * Interruption is the caller's job and it is deliberately easy: `stop()` hands
 * back both the live value AND the live velocity, so the next spring can start
 * from exactly there. Starting a new animation from the *target* value instead
 * of the *presentation* value is the classic cause of a visible jump when a
 * user grabs something mid-flight.
 */
export function spring({
  from,
  to,
  velocity = 0,
  damping = 1,
  response = 0.4,
  onFrame,
  onRest,
  restDistance = 0.4,
  restVelocity = 8,
}: SpringOptions): SpringHandle {
  const w0 = (2 * Math.PI) / Math.max(response, 0.0001); // undamped angular frequency
  const zeta = Math.max(damping, 0);
  const A = from - to;

  let solve: (t: number) => { x: number; v: number };

  if (zeta < 1) {
    // Underdamped: oscillates inside a decaying envelope.
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const B = (velocity + zeta * w0 * A) / wd;
    solve = (t) => {
      const decay = Math.exp(-zeta * w0 * t);
      const c = Math.cos(wd * t);
      const s = Math.sin(wd * t);
      return {
        x: to + decay * (A * c + B * s),
        v: decay * (-zeta * w0 * (A * c + B * s) + wd * (B * c - A * s)),
      };
    };
  } else {
    // Critically damped (and, near enough, overdamped): no oscillation.
    const B = velocity + w0 * A;
    solve = (t) => {
      const decay = Math.exp(-w0 * t);
      return {
        x: to + (A + B * t) * decay,
        v: decay * (B - w0 * A - w0 * B * t),
      };
    };
  }

  let raf = 0;
  let start = 0;
  let last = { value: from, velocity };
  let alive = true;

  const tick = (now: number) => {
    if (!alive) return;
    if (!start) start = now;
    const t = (now - start) / 1000;
    const { x, v } = solve(t);
    last = { value: x, velocity: v };

    if (Math.abs(x - to) < restDistance && Math.abs(v) < restVelocity) {
      alive = false;
      onFrame(to, 0); // land exactly on the target, never a fraction short
      onRest?.();
      return;
    }
    onFrame(x, v);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    stop() {
      alive = false;
      cancelAnimationFrame(raf);
      return last;
    },
    get running() {
      return alive;
    },
  };
}

/**
 * Where a flick would come to rest if you let it decelerate.
 *
 * This is Apple's projection function from the Designing Fluid Interfaces
 * sample code, and it is NOT the textbook v^2/(2a). Using it is what makes a
 * short fast flick throw a sheet closed while a long slow drag of the same
 * distance does not: the decision is made on where the gesture was GOING, not
 * on where the finger happened to leave the glass.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary.
 *
 * A hard stop reads as a frozen interface; resistance reads as "still with
 * you, but there is nothing more this way". Same curve UIScrollView uses.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * A short rolling history of pointer samples, for velocity at release.
 *
 * Using only the last two pointermove events is the obvious approach and it is
 * wrong: those two can be 2ms apart on a 120Hz screen, which turns a rounding
 * difference into a reported thousand pixels per second. Sampling across a
 * window smooths that out. 100ms is long enough to be stable and short enough
 * that a finger that stopped dead still reads as stopped.
 */
export class VelocityTracker {
  private samples: { v: number; t: number }[] = [];
  constructor(private windowMs = 100) {}

  add(value: number, time = performance.now()) {
    this.samples.push({ v: value, t: time });
    const cutoff = time - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** px/s over the sampled window. Zero if we cannot say honestly. */
  get velocity(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return 0;
    return (last.v - first.v) / dt;
  }

  reset() {
    this.samples = [];
  }
}

/** Does the user want us to skip the physics entirely? */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
