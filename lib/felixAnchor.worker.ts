// The pitch anchor, off the main thread.
//
// lib/pitchShift.ts is pure functions over Float32Array, and that is what
// makes this file possible: a decoded take goes in, a corrected one comes
// back, and nothing in between touches the DOM or the AudioContext. On a
// laptop the correction is a few hundred milliseconds; on a phone, on a
// 25-second take, it is seconds, and on the main thread those are seconds
// in which the report does not scroll and the button does not respond.
//
// lib/felixVoice.ts owns the worker and falls back to running the same
// function inline when a Worker cannot be made (tests, or a browser that
// refuses the chunk). Either way the audio is identical; only the thread
// differs.

import { anchorToFelix } from "./pitchShift";

export type AnchorRequest = { id: number; samples: Float32Array; sr: number };
export type AnchorResponse = {
  id: number;
  samples: Float32Array;
  from: number | null;
  ratio: number;
};

// The file is type-checked against the DOM lib like the rest of the app, and
// under it `self` is a Window, whose postMessage wants a target origin. The
// two members this file needs, with the worker's signatures.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<AnchorRequest>) => void) | null;
  postMessage(msg: AnchorResponse, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, samples, sr } = e.data;
  const r = anchorToFelix(samples, sr);
  // Transferred, not copied: the buffer moves back to the page in O(1), and
  // when nothing was done the original goes back the way it came.
  const out = r.ratio === 1 ? samples : r.samples;
  scope.postMessage({ id, samples: out, from: r.from, ratio: r.ratio }, [out.buffer]);
};
