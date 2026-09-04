import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FelixVoice } from "@/lib/felixVoice";
import { FELIX_ANCHOR_HZ } from "@/lib/pitchShift";

/* ---------------------------------------------------------------------------
   The report's Felix gets the landing page's treatment: render, measure, and
   when the voice came back far from the landing anchor, render again — up to
   three times — keeping the nearest. This drives lib/felixVoice.ts's loop
   through speak() with a fake AudioContext whose decoder hands back a real
   voiced signal at whatever pitch the test scripts for each render, so the
   measurement is the real detector and only the audio device is faked.
   --------------------------------------------------------------------------- */

vi.mock("@/lib/firebase", () => ({
  isFirebaseConfigured: () => false,
  getUser: async () => null,
}));
vi.mock("@/lib/appCheck", () => ({ getAppCheckToken: async () => null }));

const SR = 16000;

function vowel(hz: number, seconds = 1.2): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] =
      0.6 * Math.sin(2 * Math.PI * hz * t) +
      0.3 * Math.sin(2 * Math.PI * hz * 2 * t) +
      0.15 * Math.sin(2 * Math.PI * hz * 3 * t);
  }
  return out;
}

/** The pitch each successive render comes back at; null renders silence. */
let renders: Array<number | null> = [];
let decodes = 0;

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  state: AudioContextState = "running";
  sampleRate = SR;
  currentTime = 0;
  destination = {};
  createAnalyser() {
    return {
      fftSize: 1024,
      smoothingTimeConstant: 0,
      frequencyBinCount: 512,
      connect() {},
      disconnect() {},
      getByteFrequencyData() {},
    };
  }
  createBufferSource() {
    return new FakeSource();
  }
  createBuffer(_ch: number, length: number, sampleRate: number) {
    return {
      numberOfChannels: 1,
      length,
      sampleRate,
      duration: length / sampleRate,
      copyToChannel() {},
      getChannelData: () => new Float32Array(length),
    };
  }
  async decodeAudioData() {
    const hz = renders[decodes++] ?? null;
    const samples = hz === null ? new Float32Array(SR) : vowel(hz);
    return {
      numberOfChannels: 1,
      sampleRate: SR,
      length: samples.length,
      duration: samples.length / SR,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;
  }
  async resume() {}
  async close() {}
}

let fetchMock: ReturnType<typeof vi.fn>;
const takesAsked = () =>
  fetchMock.mock.calls.map(([, init]) => {
    const body = JSON.parse((init as RequestInit).body as string) as { take?: number };
    return body.take ?? 0;
  });

beforeEach(() => {
  decodes = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  fetchMock = vi.fn(
    async () =>
      new Response(new Uint8Array(64), { status: 200, headers: { "content-type": "audio/mpeg" } })
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const SRC = { kind: "text" as const, text: "Good lead-in. Keep it." };

describe("the report's Felix re-rolls toward the landing voice", () => {
  it("asks for a second render when the first is far off, and plays the nearer one", async () => {
    // Half an octave low: beyond what the anchor can correct.
    renders = [FELIX_ANCHOR_HZ / 1.4, FELIX_ANCHOR_HZ * 1.03];
    const v = new FelixVoice();
    await v.speak(SRC);
    expect(v.status).toBe("speaking");
    expect(takesAsked()).toEqual([0, 1]);
  });

  it("keeps the first render when it is already close, with no second ask", async () => {
    renders = [FELIX_ANCHOR_HZ * 1.02];
    const v = new FelixVoice();
    await v.speak(SRC);
    expect(v.status).toBe("speaking");
    expect(takesAsked()).toEqual([0]);
  });

  it("stops at the third render and plays the best of them", async () => {
    renders = [FELIX_ANCHOR_HZ / 1.5, FELIX_ANCHOR_HZ * 1.5, FELIX_ANCHOR_HZ / 1.45, FELIX_ANCHOR_HZ];
    const v = new FelixVoice();
    await v.speak(SRC);
    expect(v.status).toBe("speaking");
    expect(takesAsked()).toEqual([0, 1, 2]);
  });

  it("does not treat 'could not measure' as 'far'", async () => {
    renders = [null, FELIX_ANCHOR_HZ];
    const v = new FelixVoice();
    await v.speak(SRC);
    expect(v.status).toBe("speaking");
    expect(takesAsked()).toEqual([0]);
  });

  it("plays what it has when a later render fails to arrive", async () => {
    renders = [FELIX_ANCHOR_HZ / 1.4];
    fetchMock
      .mockImplementationOnce(
        async () =>
          new Response(new Uint8Array(64), { status: 200, headers: { "content-type": "audio/mpeg" } })
      )
      .mockImplementationOnce(async () => new Response("{}", { status: 429 }));
    const v = new FelixVoice();
    await v.speak(SRC);
    expect(v.status).toBe("speaking");
    expect(takesAsked()).toEqual([0, 1]);
  });

  it("never re-rolls a static file", async () => {
    renders = [FELIX_ANCHOR_HZ / 1.4];
    const v = new FelixVoice();
    await v.speak({ kind: "url", url: "/felix-hello.mp3" });
    expect(v.status).toBe("speaking");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
