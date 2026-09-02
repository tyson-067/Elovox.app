"use client";

import { isFirebaseConfigured } from "@/lib/firebase";
import { authHeaders } from "@/lib/felixVoice";
import { FELIX_TAKE_VERSION, felixTakeFallback, takeIsCurrent } from "@/lib/felixTake";
import type { FelixTake, Session } from "@/lib/types";

// Getting Felix's take for a session, from wherever it already is.
//
// In order: the session itself (a take written on an earlier open comes back
// with the doc, no request at all), this page's memory (a report opened
// twice in one visit), then /api/felix, which writes it once and stores it.
// Every route to it that can fail ends in the deterministic fallback
// (lib/felixTake.ts), so the module always has something to say and the
// button never waits on a spinner that goes nowhere.
//
// Shared by the report page and the practice page: the practice page asks
// the moment a take is saved, so the report that opens a second later
// usually finds the take already written.

export interface FelixTakeResult {
  take: FelixTake;
  /** Stored on the session: the voice route can read it by sessionId. */
  persisted: boolean;
  /** Came back from the doc rather than a fresh generation. */
  cached: boolean;
  /** Why it's a fallback, when it is: "sample", "unconfigured", "model-failed", "offline"… */
  reason?: string;
  /** The request itself failed (network, auth). Worth a retry later. */
  failed?: boolean;
}

const inflight = new Map<string, Promise<FelixTakeResult>>();
const memo = new Map<string, FelixTakeResult>();

/** Reasons a fallback is final for this session: asking again won't change it. */
const FINAL_REASONS = new Set(["sample", "unconfigured"]);

function fallbackFor(session: Session, reason: string, failed = false): FelixTakeResult {
  return {
    take: {
      text: felixTakeFallback(session.analysis),
      version: FELIX_TAKE_VERSION,
      generatedAt: Date.now(),
      source: "fallback",
    },
    persisted: false,
    cached: false,
    reason,
    failed,
  };
}

export function loadFelixTake(session: Session): Promise<FelixTakeResult> {
  if (takeIsCurrent(session.felix)) {
    return Promise.resolve({ take: session.felix, persisted: true, cached: true });
  }
  const remembered = memo.get(session.id);
  if (remembered) return Promise.resolve(remembered);
  const pending = inflight.get(session.id);
  if (pending) return pending;

  if (!session.analysis) return Promise.resolve(fallbackFor(session, "no-analysis"));
  if (session.analysis.isSample) {
    const r = fallbackFor(session, "sample");
    memo.set(session.id, r);
    return Promise.resolve(r);
  }

  const p = (async (): Promise<FelixTakeResult> => {
    try {
      // With Firebase the server reads its own copy of the session; the
      // analysis only travels when there is no server copy to read (local
      // dev, where sessions live in localStorage).
      const local = !isFirebaseConfigured();
      const res = await fetch("/api/felix", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          sessionId: session.id,
          ...(local
            ? { analysis: session.analysis, goal: session.goal ?? "", mode: session.mode ?? "" }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        take?: FelixTake;
        cached?: boolean;
        persisted?: boolean;
        reason?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.take || typeof data.take.text !== "string" || !data.take.text) {
        throw new Error(data.message ?? data.error ?? `felix ${res.status}`);
      }
      const result: FelixTakeResult = {
        take: data.take,
        persisted: Boolean(data.persisted),
        cached: Boolean(data.cached),
        reason: data.reason,
      };
      // Remember what won't change by asking again; leave a model failure
      // unremembered so the next open (or a retry) tries once more.
      if (result.take.source === "model" || FINAL_REASONS.has(result.reason ?? "")) {
        memo.set(session.id, result);
      }
      return result;
    } catch (err) {
      return fallbackFor(session, err instanceof Error ? err.message : "offline", true);
    } finally {
      inflight.delete(session.id);
    }
  })();
  inflight.set(session.id, p);
  return p;
}

/** Ask now so the report that opens next finds the take already written. */
export function prefetchFelixTake(session: Session): void {
  void loadFelixTake(session).catch(() => {});
}

/** For tests: forget everything this page learned. */
export function __resetFelixTakeCache(): void {
  inflight.clear();
  memo.clear();
}
