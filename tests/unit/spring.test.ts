import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { VelocityTracker, project, rubberband, spring } from "@/lib/spring";

// This file is hand-rolled physics, which is exactly the kind of code that
// looks right, runs at 120Hz on one machine, and is subtly wrong forever.

describe("project — Apple's momentum projection", () => {
  it("projects further the faster the flick", () => {
    expect(project(2000)).toBeGreaterThan(project(500));
  });

  it("keeps the sign of the gesture", () => {
    expect(project(-1200)).toBeLessThan(0);
    expect(project(1200)).toBeGreaterThan(0);
  });

  it("projects nothing when the finger stopped", () => {
    expect(project(0)).toBe(0);
  });

  it("uses exponential decay, NOT the textbook v^2/(2a)", () => {
    // (v/1000)*d/(1-d) is linear in v. The physics-textbook form is quadratic,
    // and swapping them makes a hard flick throw a sheet roughly into orbit.
    const a = project(1000);
    const b = project(2000);
    expect(b / a).toBeCloseTo(2, 5);
  });

  it("a snappier deceleration rate projects a shorter throw", () => {
    expect(project(1000, 0.99)).toBeLessThan(project(1000, 0.998));
  });
});

describe("rubberband", () => {
  it("always returns less than the raw overshoot — that is the resistance", () => {
    for (const over of [10, 50, 200, 800]) {
      expect(rubberband(over, 800)).toBeLessThan(over);
    }
  });

  it("resists progressively: the further you pull, the less you get", () => {
    const ratioNear = rubberband(50, 800) / 50;
    const ratioFar = rubberband(600, 800) / 600;
    // A constant fraction reads as lag; a shrinking one reads as an edge.
    expect(ratioFar).toBeLessThan(ratioNear);
  });

  it("moves at all near zero — a hard stop reads as frozen", () => {
    expect(rubberband(5, 800)).toBeGreaterThan(0);
  });

  it("survives a zero dimension instead of dividing by it", () => {
    expect(rubberband(100, 0)).toBe(0);
  });
});

describe("VelocityTracker", () => {
  it("reports nothing from a single sample rather than guessing", () => {
    const t = new VelocityTracker();
    t.add(0, 1000);
    expect(t.velocity).toBe(0);
  });

  it("measures across the window, not the last two events", () => {
    // Two samples 2ms apart on a 120Hz screen turn a rounding difference into
    // a reported thousand pixels per second. Sampling the window smooths it.
    const t = new VelocityTracker(100);
    t.add(0, 1000);
    t.add(50, 1050);
    t.add(100, 1100);
    expect(t.velocity).toBeCloseTo(1000, 0); // 100px over 0.1s
  });

  it("reads a finger that stopped dead as stopped", () => {
    const t = new VelocityTracker(100);
    t.add(0, 1000);
    t.add(100, 1050);
    t.add(100, 1080);
    t.add(100, 1100);
    expect(Math.abs(t.velocity)).toBeLessThan(1100);
    const still = new VelocityTracker(100);
    still.add(100, 1000);
    still.add(100, 1100);
    expect(still.velocity).toBe(0);
  });

  it("reset clears history", () => {
    const t = new VelocityTracker();
    t.add(0, 1000);
    t.add(100, 1100);
    t.reset();
    expect(t.velocity).toBe(0);
  });
});

describe("spring", () => {
  let now = 0;
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    now = 0;
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Drive the rAF queue forward by `ms`, in 8ms steps. */
  const advance = (ms: number) => {
    const end = now + ms;
    while (now < end && frames.length) {
      now += 8;
      const queued = frames;
      frames = [];
      queued.forEach((cb) => cb(now));
    }
  };

  it("lands exactly on the target, never a fraction short", () => {
    const seen: number[] = [];
    let rested = false;
    spring({
      from: 0, to: 100, damping: 1, response: 0.3,
      onFrame: (v) => seen.push(v),
      onRest: () => { rested = true; },
    });
    advance(3000);
    expect(rested).toBe(true);
    // A sheet that settles at 99.6px leaves a visible sliver on screen.
    expect(seen[seen.length - 1]).toBe(100);
  });

  it("does not overshoot when critically damped", () => {
    const seen: number[] = [];
    spring({ from: 0, to: 100, damping: 1, response: 0.3, onFrame: (v) => seen.push(v) });
    advance(3000);
    expect(Math.max(...seen)).toBeLessThanOrEqual(100.0001);
  });

  it("overshoots when under-damped — that is what bounce IS", () => {
    const seen: number[] = [];
    spring({ from: 0, to: 100, damping: 0.6, response: 0.3, onFrame: (v) => seen.push(v) });
    advance(3000);
    expect(Math.max(...seen)).toBeGreaterThan(100);
  });

  it("honours handoff velocity instead of restarting from rest", () => {
    const withV: number[] = [];
    const without: number[] = [];
    spring({ from: 0, to: 100, velocity: 800, damping: 1, response: 0.4, onFrame: (v) => withV.push(v) });
    advance(80);
    spring({ from: 0, to: 100, velocity: 0, damping: 1, response: 0.4, onFrame: (v) => without.push(v) });
    advance(80);
    // Without this the seam between dragging and animating is visible.
    expect(withV[3]).toBeGreaterThan(without[3]);
  });

  it("stop() hands back the LIVE value and velocity, for interruption", () => {
    const h = spring({ from: 0, to: 500, damping: 1, response: 0.5, onFrame: () => {} });
    advance(100);
    const live = h.stop();
    expect(h.running).toBe(false);
    // Starting the next spring from the target instead of the presentation
    // value is the classic cause of a visible jump on interrupt.
    expect(live.value).toBeGreaterThan(0);
    expect(live.value).toBeLessThan(500);
    expect(live.velocity).not.toBe(0);
  });

  it("settles the same regardless of frame rate", () => {
    // Analytic, not an integrator: every iPhone this ships to is 120Hz, and an
    // integrator would settle differently there than on a 60Hz display.
    const run = (step: number) => {
      let t = 0;
      const out: number[] = [];
      let queue: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.push(cb); return 1; });
      spring({ from: 0, to: 100, damping: 1, response: 0.4, onFrame: (v) => out.push(v) });
      while (queue.length && t < 2000) {
        t += step;
        const q = queue; queue = [];
        q.forEach((cb) => cb(t));
      }
      return out[out.length - 1];
    };
    expect(run(8)).toBeCloseTo(run(16), 3);
  });
});
