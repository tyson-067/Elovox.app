// Frame sampling for the Premium camera pass.
//
// Frames are grabbed off the live <video> element while recording rather
// than seeked out of the finished blob — seeking inside a MediaRecorder
// webm is unreliable across browsers (no duration in the header until the
// stream ends), and this way the work is spread across the recording
// instead of landing in one lump before analysis.
//
// We over-sample at a fixed interval, then thin down to an evenly-spaced
// set at stop time, because the recording length isn't known up front.

const SAMPLE_INTERVAL_MS = 2000;
const MAX_BUFFERED = 150; // ~5 minutes at the sample interval
const FRAME_WIDTH = 512; // plenty for posture/gesture/gaze; keeps payload small
const JPEG_QUALITY = 0.6;

export interface SampledFrame {
  timeSec: number;
  /** Bare base64 (no data: prefix) — what the Gemini inlineData part wants. */
  data: string;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export class FrameSampler {
  private frames: SampledFrame[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private startedAt = 0;

  constructor(private video: HTMLVideoElement) {}

  start(startedAt: number) {
    this.stop();
    this.frames = [];
    this.startedAt = startedAt;
    this.canvas = document.createElement("canvas");
    // Grab one immediately so short recordings still get an opening frame.
    this.capture();
    this.timer = setInterval(() => this.capture(), SAMPLE_INTERVAL_MS);
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private capture() {
    const video = this.video;
    const canvas = this.canvas;
    if (!canvas || !video || !video.videoWidth) return;
    if (this.frames.length >= MAX_BUFFERED) return;

    const scale = FRAME_WIDTH / video.videoWidth;
    canvas.width = FRAME_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    this.frames.push({
      timeSec: (performance.now() - this.startedAt) / 1000,
      data: dataUrl.slice(dataUrl.indexOf(",") + 1),
    });
  }

  /**
   * `count` frames spread evenly across the recording, formatted as the
   * "m:ss|<base64>" strings the analyze route expects.
   */
  collect(count: number): string[] {
    this.stop();
    const all = this.frames;
    if (all.length === 0) return [];

    const chosen =
      all.length <= count
        ? all
        : Array.from(
            { length: count },
            (_, i) => all[Math.round((i * (all.length - 1)) / (count - 1))]
          );

    return chosen.map((f) => `${formatTime(f.timeSec)}|${f.data}`);
  }

  dispose() {
    this.stop();
    this.frames = [];
    this.canvas = null;
  }
}
