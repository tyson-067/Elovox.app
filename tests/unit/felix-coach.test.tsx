import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FelixCoach, FelixCoachCard } from "@/components/FelixCoach";
import { FELIX_TAKE_VERSION } from "@/lib/felixTake";
import type { FelixTakeResult } from "@/lib/felixTakeClient";
import type { Analysis, Session } from "@/lib/types";

type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   The module at the top of a report (components/FelixCoach.tsx), end to end
   in jsdom: the take arrives (or doesn't), the button walks through
   play → pause → resume → finished → replay against the real engine on a
   fake AudioContext, and every product event fires from what the engine
   actually did. What these pin:

     - the take is on screen as text the moment it exists; the audio never
       starts on its own and is never the only copy;
     - a stored take plays by session id, an unstored one by its text, and
       a replay costs no second fetch;
     - a fallback says so and offers to ask again, except where asking again
       can't change the answer;
     - the analytics carry the surface, the goal and the mode, and nothing
       that could be read back as a transcript.
   --------------------------------------------------------------------------- */

let loadFelixTake: AnyMock;
let trackEvent: AnyMock;
vi.mock("@/lib/felixTakeClient", () => ({
  loadFelixTake: (...a: unknown[]) => loadFelixTake(...a),
  prefetchFelixTake: () => {},
}));
vi.mock("@/lib/analytics", () => ({
  trackEvent: (...a: unknown[]) => trackEvent(...a),
}));
vi.mock("@/lib/firebase", () => ({
  isFirebaseConfigured: () => true,
  getUser: async () => ({ getIdToken: async () => "id-token" }),
}));
vi.mock("@/lib/appCheck", () => ({ getAppCheckToken: async () => "app-check-token" }));
// next/link prefetches through an IntersectionObserver, which tests/setup.ts
// stubs and this file's unstubAllGlobals (needed for the fake AudioContext)
// removes again. The card only needs the anchor.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** What the fake analyser reports in every bin. 150 is a plain vowel. */
let level = 150;
/** How long the fake source "plays" before onended. */
let endAfterMs = 80;

class FakeAnalyser {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  connect() {}
  disconnect() {}
  getByteFrequencyData(a: Uint8Array) {
    a.fill(level);
  }
}
class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  private t: ReturnType<typeof setTimeout> | null = null;
  connect() {}
  disconnect() {}
  start() {
    this.t = setTimeout(() => this.onended?.(), endAfterMs);
  }
  stop() {
    if (this.t) clearTimeout(this.t);
  }
}
class FakeAudioContext {
  state: AudioContextState = "running";
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  createAnalyser() {
    return new FakeAnalyser();
  }
  createBufferSource() {
    return new FakeSource();
  }
  async decodeAudioData() {
    return { duration: endAfterMs / 1000 } as AudioBuffer;
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
    this.state = "closed";
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

const analysis: Analysis = {
  overall: 74,
  summary: "Confident opening, rushed close.",
  skills: [{ skill: "Pacing", score: 58, note: "The last twenty seconds ran." }],
  transcript: [],
  tips: ["Pause before the key line."],
  paceWpm: 170,
  fillerWords: 3,
  pauses: 1,
};

const session: Session = {
  id: "s1",
  category: "general-coaching",
  mode: "own",
  goal: "Sound like a leader",
  prompt: "A pitch",
  createdAt: 1,
  durationSec: 60,
  analysis,
};

const TAKE =
  "Confident start. Your opening line was plain and it landed. The close ran away from you. Next time, stop before the last line and count two.";

function result(over: Partial<FelixTakeResult> = {}): FelixTakeResult {
  return {
    take: { text: TAKE, version: FELIX_TAKE_VERSION, generatedAt: 1, source: "model" },
    persisted: true,
    cached: false,
    ...over,
  };
}

const status = () =>
  (document.querySelector(".felix-coach") as HTMLElement).dataset.audio;
const audioButton = () => screen.getByRole("button", { name: /Hear Felix|Pause|Resume|Replay|Loading|voice/ });
const events = () => trackEvent.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  level = 150;
  endAfterMs = 80;
  loadFelixTake = vi.fn().mockResolvedValue(result()) as AnyMock;
  trackEvent = vi.fn() as AnyMock;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal(
    "requestAnimationFrame",
    (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  fetchMock = vi.fn(
    async () =>
      new Response(new Uint8Array(1234), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCoach(over: Partial<Parameters<typeof FelixCoach>[0]> = {}) {
  return render(
    <FelixCoach
      session={session}
      practiceHref="/practice?category=general-coaching"
      practiceLabel="Run it again"
      {...over}
    />
  );
}

describe("FelixCoach — the take", () => {
  it("says he's reviewing until the take arrives, with the way on already there", async () => {
    let resolve!: (r: FelixTakeResult) => void;
    loadFelixTake.mockReturnValue(new Promise<FelixTakeResult>((r) => (resolve = r)));
    renderCoach();

    expect(screen.getByRole("status").textContent).toBe("Felix is reviewing how you came across…");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Run it again" })).toHaveAttribute(
      "href",
      "/practice?category=general-coaching"
    );
    expect(document.querySelector(".felix-coach-portrait")).toHaveAttribute("data-state", "thinking");
    expect(events()).toEqual([]);

    resolve(result());
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector(".felix-coach-portrait")).toHaveAttribute("data-state", "idle");
  });

  it("shows the take as text, counts it as shown, and asks for it exactly once", async () => {
    renderCoach();
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());
    expect(loadFelixTake).toHaveBeenCalledTimes(1);
    expect(loadFelixTake).toHaveBeenCalledWith(session);
    expect(trackEvent).toHaveBeenCalledWith("felix_feedback_shown", {
      surface: "report",
      variant: "web",
      mode: "own",
      goal: "leader",
      source: "model",
      cached: false,
    });
    expect(screen.getByRole("button", { name: "Hear Felix's feedback" })).toBeTruthy();
    // A portrait, not a whole fox: the crop is the head.
    expect(document.querySelector('svg[data-crop="portrait"]')).not.toBeNull();
    // Nothing plays on its own.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the Daily Minute with his line", async () => {
    renderCoach({ surface: "daily", practiceLabel: "Try again, beat this score" });
    // The intro is there from the first paint, before the take.
    expect(screen.getByText("Here's how you came across.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again, beat this score" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());
    expect(trackEvent.mock.calls[0][1]).toMatchObject({ surface: "daily" });
  });

  it("a fallback says so and offers to ask again; asking again asks again", async () => {
    loadFelixTake.mockResolvedValue(
      result({ take: { ...result().take, source: "fallback" }, persisted: false, reason: "model-failed" })
    );
    renderCoach();
    await waitFor(() => expect(screen.getByText(/straight from your report/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Ask Felix again" }));
    await waitFor(() => expect(loadFelixTake).toHaveBeenCalledTimes(2));
  });

  it("a sample report's fallback carries no apology and no retry", async () => {
    loadFelixTake.mockResolvedValue(
      result({ take: { ...result().take, source: "fallback" }, persisted: false, reason: "sample" })
    );
    renderCoach();
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());
    expect(screen.queryByText(/from your report/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask Felix again" })).toBeNull();
  });

  it("reports a goal-less session as none, and never the take's words", async () => {
    renderCoach({ session: { ...session, goal: undefined, mode: undefined } });
    await waitFor(() => expect(trackEvent).toHaveBeenCalled());
    const props = trackEvent.mock.calls[0][1] as Record<string, unknown>;
    expect(props).toMatchObject({ goal: "none", mode: "unknown" });
    expect(JSON.stringify(props)).not.toContain("Confident");
  });
});

describe("FelixCoach — hearing it", () => {
  it("plays a stored take by session id; replays from memory; counts each step once", async () => {
    renderCoach();
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());

    fireEvent.click(audioButton());
    await waitFor(() => expect(status()).toBe("speaking"));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/voice");
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: "s1", text: TAKE });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer id-token");
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(document.querySelector(".felix-coach-portrait")).toHaveAttribute("data-state", "speaking");
    // The mouth is moving with the sound.
    await waitFor(() => {
      const el = document.querySelector(".felix-coach-portrait") as HTMLElement;
      expect(parseFloat(el.style.getPropertyValue("--felix-open"))).toBeGreaterThan(0.5);
    });

    await waitFor(() => expect(status()).toBe("finished"), { timeout: 2000 });
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
    const portrait = document.querySelector(".felix-coach-portrait") as HTMLElement;
    expect(portrait.style.getPropertyValue("--felix-open")).toBe("0.000");
    expect(portrait).toHaveAttribute("data-state", "idle");
    expect(events()).toEqual(["felix_feedback_shown", "felix_feedback_played", "felix_feedback_completed"]);

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    await waitFor(() => expect(status()).toBe("speaking"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events()).toContain("felix_feedback_replayed");
  });

  it("pauses and resumes where it left off", async () => {
    endAfterMs = 5000;
    renderCoach();
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());

    fireEvent.click(audioButton());
    await waitFor(() => expect(status()).toBe("speaking"));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(status()).toBe("paused"));
    // Mouth shut while he waits.
    const portrait = document.querySelector(".felix-coach-portrait") as HTMLElement;
    expect(portrait.style.getPropertyValue("--felix-open")).toBe("0.000");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(status()).toBe("speaking"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events().filter((e) => e === "felix_feedback_played")).toHaveLength(1);
  });

  it("an unstored take is read from its text", async () => {
    loadFelixTake.mockResolvedValue(result({ persisted: false }));
    renderCoach();
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());
    fireEvent.click(audioButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ text: TAKE });
  });

  it("when the voice fails, the take is still there and the button offers another go", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "voice-unavailable", message: "Felix's voice isn't set up on this server yet." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })
    );
    renderCoach();
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());
    fireEvent.click(audioButton());
    await waitFor(() => expect(status()).toBe("error"));
    expect(screen.getByRole("status").textContent).toBe(
      "Felix's voice isn't set up on this server yet. His notes are above."
    );
    expect(screen.getByText(TAKE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try the voice again" })).toBeTruthy();
    expect(events()).not.toContain("felix_feedback_played");
  });

  it("counts the way back into the booth", async () => {
    renderCoach();
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());
    fireEvent.click(screen.getByRole("link", { name: "Run it again" }));
    expect(events()).toContain("felix_try_again_clicked");
  });

  it("lets go of the sound when the page does", async () => {
    endAfterMs = 5000;
    const view = renderCoach();
    await waitFor(() => expect(screen.getByText(TAKE)).toBeTruthy());
    fireEvent.click(audioButton());
    await waitFor(() => expect(status()).toBe("speaking"));
    expect(() => view.unmount()).not.toThrow();
  });
});

describe("FelixCoachCard — the landing sample", () => {
  it("plays a static file with no session and no sign-in", async () => {
    render(
      <FelixCoachCard
        text="Nice work. You came across as confident."
        source={{ kind: "url", url: "/felix-hello.mp3" }}
        audioLabel="Hear Felix"
        action={{ href: "/signup", label: "Try it free" }}
      />
    );
    expect(screen.getByText("Nice work. You came across as confident.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hear Felix" }));
    await waitFor(() => expect(status()).toBe("speaking"));
    expect(fetchMock).toHaveBeenCalledWith("/felix-hello.mp3");
    expect(screen.getByRole("link", { name: "Try it free" })).toHaveAttribute("href", "/signup");
  });

  it("with nothing to play, is a card of text and the way on", () => {
    render(<FelixCoachCard text="A line." source={null} action={{ href: "/x", label: "Go" }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Go" })).toBeTruthy();
  });
});
