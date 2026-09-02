"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FelixVoice,
  type FelixFrame,
  type FelixVoiceSource,
  type FelixVoiceStatus,
} from "@/lib/felixVoice";

export type { FelixVoiceSource, FelixVoiceStatus };

/**
 * A talking Felix for React.
 *
 * Status and error go through state, because the button that shows them
 * re-renders a few times per play. The face does NOT: every frame is written
 * as three custom properties straight onto the element handed to `bind`,
 * and the fox inside inherits them (see .felix-cavity and friends in
 * globals.css). Progress goes the same way, onto the element handed to
 * `bindProgress`, as --felix-progress. Sixty React renders a second on a
 * report page is exactly the stutter a per-frame React setState causes.
 */
export function useFelixVoice() {
  const engine = useRef<FelixVoice | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const progressTarget = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<FelixVoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Reads a ref and writes to the DOM: stable for the life of the hook, so
  // the engine can hold it without ever being re-subscribed.
  const paint = useCallback((f: FelixFrame) => {
    const el = target.current;
    if (!el) return;
    el.style.setProperty("--felix-open", f.open.toFixed(3));
    el.style.setProperty("--felix-wide", f.wide.toFixed(3));
    el.style.setProperty("--felix-tilt", f.tilt.toFixed(2));
  }, []);

  const paintProgress = useCallback((p: number) => {
    const el = progressTarget.current;
    if (!el) return;
    el.style.setProperty("--felix-progress", p.toFixed(3));
  }, []);

  const get = useCallback((): FelixVoice => {
    if (!engine.current) {
      const v = new FelixVoice();
      v.onStatus((s, err) => {
        setStatus(s);
        setError(s === "error" ? (err ?? "Felix lost his voice.") : null);
      });
      v.onFrame(paint);
      v.onProgress(paintProgress);
      engine.current = v;
    }
    return engine.current;
  }, [paint, paintProgress]);

  const bind = useCallback((el: HTMLElement | null) => {
    target.current = el;
  }, []);
  const bindProgress = useCallback((el: HTMLElement | null) => {
    progressTarget.current = el;
  }, []);

  const speak = useCallback((src: FelixVoiceSource) => get().speak(src), [get]);
  const stop = useCallback(() => engine.current?.stop(), []);
  const pause = useCallback(() => engine.current?.pause(), []);
  const resume = useCallback(() => engine.current?.resume(), []);
  const preload = useCallback((src: FelixVoiceSource) => get().preload(src), [get]);
  /** Tap-to-hear: a tap while he talks stops him; otherwise he starts. */
  const toggle = useCallback(
    (src: FelixVoiceSource) => {
      const v = get();
      if (v.status === "speaking" || v.status === "loading" || v.status === "paused") v.stop();
      else void v.speak(src);
    },
    [get]
  );

  useEffect(() => () => engine.current?.dispose(), []);

  return { status, error, speak, stop, pause, resume, toggle, preload, bind, bindProgress };
}
