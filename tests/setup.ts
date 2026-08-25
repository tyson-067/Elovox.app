import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom ships neither of these, and the reveal system is built on the first.
// Stubbing IO as "immediately visible" is the right default here: it mirrors
// lib/useReveal.ts's own invariant that when we cannot tell whether something
// is on screen, the honest answer is to SHOW it. A test suite that hid content
// by default would be asserting the opposite of the rule the app follows.
class IO {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) {
    this.cb(
      [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
  root = null;
  rootMargin = "";
  thresholds = [];
}
vi.stubGlobal("IntersectionObserver", IO);

vi.stubGlobal(
  "matchMedia",
  (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
);
