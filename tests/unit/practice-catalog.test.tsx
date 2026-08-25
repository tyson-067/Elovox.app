import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Plan } from "@/lib/plan";

// usePlan reads Firestore. The three states it can return are the whole
// subject of this file, so it is the one thing mocked.
const planState: { plan: Plan | null; isPremium: boolean } = {
  plan: null,
  isPremium: false,
};
vi.mock("@/lib/plan", () => ({
  usePlan: () => planState,
  usePlanRecord: () => ({ record: null }),
}));
// Renders null in a browser anyway (useIsNative), but it pulls in the native
// runtime, which is not what this file is testing.
vi.mock("@/components/native/NativeLibraryList", () => ({
  NativeLibraryList: () => null,
}));

const { PracticeCatalogPage } = await import("@/components/PracticeCatalogPage");

const ITEMS = [
  { id: "a", name: "Job interview", description: "Hiring managers and panels." },
  { id: "b", name: "College admissions", description: "Alumni interviews." },
];

const renderPage = () =>
  render(
    <PracticeCatalogPage
      title="Interview practice"
      tipLabel="How does it work?"
      tip="Felix asks, you answer."
      lead="Pick the room."
      items={ITEMS}
      hrefFor={(t) => `/practice?interview=${t.id}`}
      columns={3}
      upsellHeading="Practicing for something specific?"
      upsellBody="Premium adds interview practice by type."
    />
  );

describe("PracticeCatalogPage", () => {
  beforeEach(() => {
    planState.plan = null;
    planState.isPremium = false;
  });

  it("shows NO lock and NO upsell while the plan is still resolving", () => {
    // THE regression this file exists for. plan === null means "we do not know
    // yet". Rendering the locked state during that window means every paying
    // subscriber sees a paywall flash on every cold load, which reads as
    // "my subscription is gone". It was previously copy-pasted into four
    // separate pages, i.e. four chances to get it wrong.
    planState.plan = null;
    renderPage();
    expect(screen.getByText("Job interview")).toBeInTheDocument();
    expect(screen.queryByText(/Unlocks with Premium/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Practicing for something specific/i)).not.toBeInTheDocument();
  });

  it("locks the cards and offers the upsell on the free plan", () => {
    planState.plan = "free";
    planState.isPremium = false;
    renderPage();
    expect(screen.getAllByText(/Unlocks with Premium/i)).toHaveLength(ITEMS.length);
    expect(screen.getByText(/Practicing for something specific/i)).toBeInTheDocument();
  });

  it("links every card to practice for a subscriber, and drops the upsell", () => {
    planState.plan = "premium";
    planState.isPremium = true;
    renderPage();
    const links = screen.getAllByRole("link");
    expect(links.some((a) => a.getAttribute("href") === "/practice?interview=a")).toBe(true);
    expect(screen.queryByText(/Unlocks with Premium/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Practicing for something specific/i)).not.toBeInTheDocument();
  });

  it("never renders a price — the iOS app loads this same page", () => {
    // App Store guideline 3.1.1. The upsell may NAME Premium; it may not say
    // what it costs, because the shell renders this deployment verbatim.
    for (const p of ["free", "premium", null] as const) {
      planState.plan = p;
      planState.isPremium = p === "premium";
      const { container, unmount } = renderPage();
      expect(container.textContent).not.toMatch(/\$\s?\d/);
      expect(container.textContent).not.toMatch(/\/\s?(year|month|week)\b/);
      unmount();
    }
  });

  it("keeps the web-only surface behind native-hide", () => {
    // The app renders NativeLibraryList instead. If these markers are dropped
    // the shell shows a web page inside itself.
    planState.plan = "free";
    const { container } = renderPage();
    expect(container.querySelectorAll(".native-hide").length).toBeGreaterThan(0);
  });
});
