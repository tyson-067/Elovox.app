// The engine behind a talking Felix: fetch the audio, play it, and hand the
// live spectrum to lib/lipSync.ts sixty times a second, which turns it into
// the three numbers a face is drawn from.
//
// Why analysis rather than timestamps: Fish Audio hands back audio and
// nothing else, so there is no phoneme track to key mouth shapes off. The
// audio itself is a perfectly good one, and reading the sound that is
// actually playing means the face cannot drift out of sync.
//
// Framework-free on purpose. lib/useFelixVoice.ts wraps it for React;
// FelixSpeaks.tsx and FelixCoach.tsx wire the frames to CSS custom
// properties.

import { getUser, isFirebaseConfigured } from "@/lib/firebase";
import { getAppCheckToken } from "@/lib/appCheck";
import {
  analyseFrame,
  REST_FRAME,
  REST_STATE,
  type FelixFrame,
  type LipState,
} from "@/lib/lipSync";
import { anchorToFelix } from "@/lib/pitchShift";

export type { FelixFrame };

/**
 * idle      nothing playing, nothing asked for (or stopped early)
 * loading   fetching or decoding, the tap has happened
 * speaking  audio running, mouth moving
 * paused    the clock is held; resume() picks up where it stopped
 * finished  the take played to its end; a replay starts over
 * error     couldn't fetch, decode, or start
 */
export type FelixVoiceStatus =
  | "idle"
  | "loading"
  | "speaking"
  | "paused"
  | "finished"
  | "error";

export type FelixVoiceSource =
  /** A line to read, through /api/voice. */
  | { kind: "text"; text: string }
  /** A static file. The landing page's sample. */
  | { kind: "url"; url: string }
  /**
   * Felix's take on one of the caller's sessions. The server reads the take
   * from the session doc and caches the audio on it; `text` rides along only
   * for local development, where there is no server copy to read.
   */
  | { kind: "session"; sessionId: string; text: string };

/**
 * The headers every signed-in call to our own API wants: the ID token says
 * who, the App Check token says the call came from our client. Mirrors
 * lib/generated.ts. Empty of both when Firebase isn't configured (local
 * dev), which the server treats as the local-dev user.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (isFirebaseConfigured()) {
    const user = await getUser();
    if (user) {
      const [idToken, appCheckToken] = await Promise.all([
        user.getIdToken(),
        getAppCheckToken(),
      ]);
      headers.Authorization = `Bearer ${idToken}`;
      if (appCheckToken) headers["X-Firebase-AppCheck"] = appCheckToken;
    }
  }
  return headers;
}

function cacheKey(src: FelixVoiceSource): string {
  switch (src.kind) {
    case "url":
      return `url:${src.url}`;
    case "session":
      return `session:${src.sessionId}`;
    default:
      return `text:${src.text}`;
  }
}

export class FelixVoice {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private node: AudioBufferSourceNode | null = null;
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private raf = 0;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private playToken = 0;
  private lip: LipState = REST_STATE;
  /** Where on the context's clock the current take started, and how long it is. */
  private startedAtCtx = 0;
  private duration = 0;

  // Decoded audio by source, so replaying a report costs nothing and hits no
  // limit, and an in-flight fetch is shared rather than duplicated by a
  // double tap.
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer>>();

  private frameListeners = new Set<(f: FelixFrame) => void>();
  private progressListeners = new Set<(p: number) => void>();
  private statusListeners = new Set<(s: FelixVoiceStatus, error?: string) => void>();

  status: FelixVoiceStatus = "idle";
  error: string | null = null;

  onFrame(cb: (f: FelixFrame) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  /** 0..1 through the current take, once a frame while it plays. */
  onProgress(cb: (p: number) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  onStatus(cb: (s: FelixVoiceStatus, error?: string) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /** Warm the decoded buffer without playing, so the first tap is instant. */
  async preload(src: FelixVoiceSource): Promise<void> {
    await this.load(src);
  }

  /**
   * Fetch (or reuse), then play, then animate until the tail of the last
   * word has closed the mouth. Resolves when playback has been *started*;
   * completion is reported through onStatus.
   */
  async speak(src: FelixVoiceSource): Promise<void> {
    const token = ++this.playToken;
    this.stopPlayback();
    // The context is created and resumed HERE, synchronously, inside the tap
    // that called us and before the first await. Safari and the iOS shell
    // only honour resume() while the gesture is live: do it after the fetch
    // and the whole take plays silently forever with his mouth shut.
    const ctx = this.context();
    const resumed =
      ctx.state === "suspended" ? ctx.resume().catch(() => {}) : Promise.resolve();
    this.setStatus("loading");
    let buffer: AudioBuffer;
    try {
      buffer = await this.load(src);
    } catch (err) {
      if (token !== this.playToken) return; // superseded by a later call
      this.setStatus("error", err instanceof Error ? err.message : "Felix lost his voice.");
      return;
    }
    if (token !== this.playToken) return;
    await resumed;
    if (token !== this.playToken) return;
    if (ctx.state !== "running") {
      // One more go now that there is something to play, then be honest: a
      // "speaking" fox with a suspended clock never ends and never moves.
      await ctx.resume().catch(() => {});
      if (token !== this.playToken) return;
      // Re-read: TS narrowed `state` above and doesn't know resume() moves it.
      if ((ctx.state as AudioContextState) !== "running") {
        this.setStatus("error", "Your browser held the sound back. Tap him again.");
        return;
      }
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.45;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.analyser = analyser;

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(analyser);
    analyser.connect(ctx.destination);
    // The end is an audio-thread event, not a frame, and it must finish the
    // take even when no frame is coming, which is every background tab.
    // Waiting for the next tick to notice left the button on "Stop" for
    // anyone who switched away mid-sentence and came back.
    node.onended = () => {
      if (this.node === node) this.finish();
    };
    this.node = node;
    this.startedAtCtx = ctx.currentTime;
    this.duration = buffer.duration;
    node.start();
    // And a clock that stalls (an iOS interruption, a tab put to sleep)
    // never reaches onended at all. The mouth still closes, the button
    // still resets.
    this.armDeadline(buffer.duration);

    this.emitProgress(0);
    this.setStatus("speaking");
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * Hold the take where it is. A buffer source can't pause, but the context
   * can: suspending it freezes the clock, the sound and `currentTime`
   * together, so resume() continues from exactly this sample. The mouth
   * closes while he waits; a face frozen mid-vowel reads as a crash.
   */
  pause(): void {
    if (this.status !== "speaking" || !this.ctx) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearDeadline();
    void this.ctx.suspend().catch(() => {});
    this.lip = REST_STATE;
    this.emit(REST_FRAME);
    this.setStatus("paused");
  }

  resume(): void {
    if (this.status !== "paused" || !this.ctx || !this.node) return;
    void this.ctx.resume().catch(() => {});
    this.armDeadline(Math.max(0, this.duration - this.elapsed()));
    this.setStatus("speaking");
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Playback is over, however it got there: face to rest, button to "again". */
  private finish() {
    this.stopPlayback();
    this.emit(REST_FRAME);
    this.emitProgress(1);
    this.setStatus("finished");
  }

  /** Stopped early, by a tap or by unmount. */
  stop(): void {
    this.playToken++;
    this.stopPlayback();
    this.emit(REST_FRAME);
    this.emitProgress(0);
    if (this.status !== "idle") this.setStatus("idle");
  }

  /** Release the AudioContext. For unmount; a stopped engine can be reused. */
  dispose(): void {
    this.stop();
    this.frameListeners.clear();
    this.progressListeners.clear();
    this.statusListeners.clear();
    this.buffers.clear();
    this.pending.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  // --- internals ---------------------------------------------------------

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private elapsed(): number {
    if (!this.ctx) return 0;
    const t = this.ctx.currentTime - this.startedAtCtx;
    return t < 0 ? 0 : t > this.duration ? this.duration : t;
  }

  private armDeadline(seconds: number) {
    this.clearDeadline();
    this.deadlineTimer = setTimeout(() => this.finish(), seconds * 1000 + 1500);
  }

  private clearDeadline() {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
  }

  private setStatus(s: FelixVoiceStatus, error?: string) {
    this.status = s;
    this.error = s === "error" ? (error ?? "Felix lost his voice.") : null;
    for (const cb of this.statusListeners) cb(s, this.error ?? undefined);
  }

  private emit(f: FelixFrame) {
    for (const cb of this.frameListeners) cb(f);
  }

  private emitProgress(p: number) {
    for (const cb of this.progressListeners) cb(p);
  }

  private stopPlayback() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearDeadline();
    if (this.node) {
      this.node.onended = null;
      try {
        this.node.stop();
      } catch {
        // already stopped
      }
      this.node.disconnect();
      this.node = null;
    }
    this.analyser?.disconnect();
    this.analyser = null;
    this.lip = REST_STATE;
    // A context left suspended by pause() would hold the next take's clock
    // too. speak() resumes it inside the next tap; nothing to do here.
  }

  /**
   * Pull a clip onto the landing page's pitch.
   *
   * The free Fish Audio model returns a different generic voice on every call,
   * so a report synthesised from the take you just recorded arrives in a
   * different fox than the one on the front door. The landing page avoids that
   * by cutting both its takes from a single render; a report cannot, because
   * its words do not exist until you speak them. Vercel's Node runtime has no
   * ffmpeg, so the correction that build-time uses is done here instead.
   *
   * Once per clip, on load rather than on play, and cached with the buffer —
   * the work is a few hundred milliseconds of arithmetic on a phone and there
   * is no reason to repeat it every time someone presses the button.
   *
   * Mono in practice (Fish Audio returns one channel). If a stereo clip ever
   * arrives it is left alone rather than half-corrected: lib/pitchShift works a
   * channel at a time, and shifting one channel and not the other would be a
   * worse artefact than the mismatch it is fixing.
   */
  private anchor(buffer: AudioBuffer): AudioBuffer {
    if (buffer.numberOfChannels !== 1) return buffer;
    try {
      const { samples, ratio } = anchorToFelix(
        buffer.getChannelData(0),
        buffer.sampleRate
      );
      if (ratio === 1) return buffer;
      const out = this.context().createBuffer(1, samples.length, buffer.sampleRate);
      out.copyToChannel(new Float32Array(samples), 0);
      return out;
    } catch {
      // Never let a cosmetic correction be the reason Felix does not speak.
      return buffer;
    }
  }

  private load(src: FelixVoiceSource): Promise<AudioBuffer> {
    const key = cacheKey(src);
    const cached = this.buffers.get(key);
    if (cached) return Promise.resolve(cached);
    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const p = (async () => {
      const bytes = await this.fetchAudio(src);
      // decodeAudioData needs its own copy: some browsers detach the buffer.
      const decoded = await this.context().decodeAudioData(bytes.slice(0));
      const buffer = this.anchor(decoded);
      this.buffers.set(key, buffer);
      return buffer;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  private async fetchAudio(src: FelixVoiceSource): Promise<ArrayBuffer> {
    if (src.kind === "url") {
      const res = await fetch(src.url);
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "Felix is still warming up his voice."
            : "Couldn't load Felix's voice just now."
        );
      }
      return res.arrayBuffer();
    }
    const body =
      src.kind === "session"
        ? { sessionId: src.sessionId, text: src.text }
        : { text: src.text };
    const res = await fetch("/api/voice", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new Error(data.message ?? data.error ?? "Felix couldn't read that just now.");
    }
    return res.arrayBuffer();
  }

  private tick = () => {
    const analyser = this.analyser;
    const ctx = this.ctx;
    if (!analyser || !ctx) return;
    analyser.getByteFrequencyData(this.freq);
    const { state, frame } = analyseFrame(
      this.freq,
      ctx.sampleRate / analyser.fftSize,
      this.lip,
      performance.now()
    );
    this.lip = state;
    this.emit(frame);
    if (this.duration > 0) this.emitProgress(this.elapsed() / this.duration);
    this.raf = requestAnimationFrame(this.tick);
  };
}
