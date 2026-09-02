import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FelixSpeaks } from "@/components/FelixSpeaks";

/* ---------------------------------------------------------------------------
   The whole client side of a talking Felix, end to end, in jsdom: the button
   → lib/useFelixVoice.ts → lib/felixVoice.ts → lib/lipSync.ts → three custom
   properties on the wrapper. jsdom has no Web Audio, so the context is a
   fake that reports whatever level the test sets and ends playback on a
   timer; everything else is the real code. This is the test a browser pane
   with no frame loop couldn't run.
   --------------------------------------------------------------------------- */

let firebaseConfigured = false;
vi.mock("@/lib/firebase", () => ({
  isFirebaseConfigured: () => firebaseConfigured,
  getUser: async () => ({ getIdToken: async () => "id-token" }),
}));
vi.mock("@/lib/appCheck", () => ({ getAppCheckToken: async () => "app-check-token" }));

/** What the fake analyser reports in every bin. 150 is a plain vowel. */
let level = 0;
/** How long the fake source "plays" before onended. */
let endAfterMs = 80;
const decoded: number[] = [];

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
  destination = {};
  createAnalyser() {
    return new FakeAnalyser();
  }
  createBufferSource() {
    return new FakeSource();
  }
  async decodeAudioData(b: ArrayBuffer) {
    decoded.push(b.byteLength);
    return { duration: 0.08 } as AudioBuffer;
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  level = 0;
  endAfterMs = 80;
  decoded.length = 0;
  firebaseConfigured = false;
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

const status = () => (document.querySelector(".felix-speaks") as HTMLElement).dataset.status;
const openOf = () => {
  const wrapper = screen.getByRole("button").querySelector("span") as HTMLSpanElement;
  return parseFloat(wrapper.style.getPropertyValue("--felix-open") || "0");
};

describe("FelixSpeaks", () => {
  it("is a button named for what it does, with a fox and a shut mouth inside", () => {
    render(<FelixSpeaks src="/felix-hello.mp3" label="Hear Felix's voice" />);
    const btn = screen.getByRole("button", { name: "Hear Felix's voice" });
    expect(btn.querySelector("svg[data-mood]")).not.toBeNull();
    expect(btn.querySelector(".felix-cavity")).not.toBeNull();
    expect(btn.querySelector(".felix-lips")).not.toBeNull();
    expect(status()).toBe("idle");
    expect(openOf()).toBe(0);
  });

  it("plays a file: fetches, decodes, opens the mouth to the sound, shuts it at the end", async () => {
    level = 150;
    // The default 80ms of "playback" is only ~5 ticks of the 16ms frame loop
    // (rAF is stubbed as setTimeout in beforeEach). The mouth assertion below
    // needs one of those to land while the source is still playing; when the
    // suite runs files in parallel those callbacks slip past onended, the
    // engine shuts the mouth to 0, and waiting longer cannot recover it.
    endAfterMs = 400;
    render(<FelixSpeaks src="/felix-hello.mp3" mood="listening" speakingMood="coach" />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(status()).toBe("speaking"));
    expect(fetchMock).toHaveBeenCalledWith("/felix-hello.mp3");
    expect(decoded).toEqual([1234]);
    expect(screen.getByRole("button", { name: "Stop Felix" })).toBeTruthy();
    // The mood swap while talking: eyes open, glasses on.
    expect(document.querySelector('svg[data-mood="coach"]')).not.toBeNull();

    await waitFor(() => expect(openOf()).toBeGreaterThan(0.5));

    // Played to the end: "finished", not "idle", so a caller can offer a
    // replay rather than a first play. The badge is back to the speaker.
    await waitFor(() => expect(status()).toBe("finished"), { timeout: 2000 });
    expect(openOf()).toBe(0);
    expect(document.querySelector('svg[data-mood="listening"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Hear Felix" })).toBeTruthy();
  });

  it("reads text through /api/voice with the signed-in headers", async () => {
    firebaseConfigured = true;
    render(<FelixSpeaks text="Strong close. Lose the hedge." />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/voice");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Strong close. Lose the hedge." });
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer id-token");
    expect(h["X-Firebase-AppCheck"]).toBe("app-check-token");
  });

  it("a second tap stops him, mouth shut", async () => {
    level = 150;
    endAfterMs = 5000;
    render(<FelixSpeaks src="/x.mp3" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(status()).toBe("speaking"));
    await waitFor(() => expect(openOf()).toBeGreaterThan(0.5));

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(status()).toBe("idle"));
    expect(openOf()).toBe(0);
  });

  it("replays from memory: a second play of the same line costs no fetch", async () => {
    level = 150;
    render(<FelixSpeaks src="/x.mp3" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(status()).toBe("speaking"));
    await waitFor(() => expect(status()).toBe("finished"), { timeout: 2000 });

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(status()).toBe("speaking"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says why when the server can't, and announces it", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "voice-unavailable",
          message: "Felix's voice isn't set up on this server yet.",
        }),
        { status: 503, headers: { "content-type": "application/json" } }
      )
    );
    render(<FelixSpeaks text="Anything." />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(status()).toBe("error"));
    expect(screen.getByRole("status").textContent).toBe(
      "Felix's voice isn't set up on this server yet."
    );
    expect(openOf()).toBe(0);
  });

  it("is quiet, not broken, when the landing sample hasn't been written yet", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    render(<FelixSpeaks src="/felix-hello.mp3" showNote={false} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(status()).toBe("error"));
    // Announced for assistive tech, printed nowhere.
    expect(screen.getByRole("status").className).toBe("sr-only");
    expect(screen.getByRole("button").title).toBe("Felix is still warming up his voice.");
  });

  it("does nothing without a line to say", () => {
    render(<FelixSpeaks />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
