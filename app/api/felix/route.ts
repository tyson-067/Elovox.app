import { NextRequest, NextResponse } from "next/server";
import { generateJson, geminiKey } from "@/lib/gemini";
import {
  verifyVerifiedUser,
  enforceAppCheck,
  logRejectedInput,
  clientIp,
} from "@/lib/verify";
import { limitOr429 } from "@/lib/rateLimit";
import { sanitizeText } from "@/lib/validation";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { overAiSpendCeiling, recordAiOperation } from "@/lib/opsMetrics";
import { isRestricted } from "@/lib/moderation";
import { usageDateKey, reserveMeteredUse } from "@/lib/quota";
import { readJsonObject } from "@/lib/requestBody";
import {
  FELIX_TAKE_MIN_WORDS,
  FELIX_TAKE_SCHEMA,
  FELIX_TAKE_SYSTEM,
  FELIX_TAKE_VERSION,
  felixTakeFallback,
  felixTakePrompt,
  takeIsCurrent,
  tidyTake,
  wordCount,
} from "@/lib/felixTake";
import type { Analysis, FelixTake, PracticeMode } from "@/lib/types";

// Felix's take: the thirty seconds he says before you read the report.
//
//   POST { sessionId }  →  { take, cached, persisted }
//
// The take is written ONCE per session. The first open of a report asks
// here; the model writes thirty to sixty words from the saved analysis
// (lib/felixTake.ts) and the result is merged onto the session doc, so every
// later open, on any device, reads it back from Firestore and this route
// answers from the doc without touching Gemini. The client never sends the
// analysis: the server reads the user's own copy, so a take can only ever be
// about a session that user recorded.
//
// When the model can't (no key, a timeout, a sample report) the response is
// still a take, assembled from the report itself and marked `fallback`. It
// is never stored, so the next open tries the model again.
//
// Same guard order as /api/speech and /api/voice: who, how often, from
// where, in good standing, then the daily meter immediately before the paid
// call. A cache hit costs no meter.

export const runtime = "nodejs";
export const maxDuration = 30;

/** Durable per-user daily ceiling on model-written takes. */
const FELIX_TAKES_PER_DAY = 60;

const SESSION_ID = /^[A-Za-z0-9_-]{1,120}$/;

function looksLikeAnalysis(a: unknown): a is Analysis {
  if (!a || typeof a !== "object") return false;
  const x = a as Partial<Analysis>;
  return typeof x.summary === "string" && typeof x.overall === "number";
}

function fallback(analysis: Analysis, reason: string): NextResponse {
  const take: FelixTake = {
    text: felixTakeFallback(analysis),
    version: FELIX_TAKE_VERSION,
    generatedAt: Date.now(),
    source: "fallback",
  };
  return NextResponse.json({ take, cached: false, persisted: false, reason });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const uid = await verifyVerifiedUser(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (uid === "unverified") {
    return NextResponse.json({ error: "verify your email first" }, { status: 403 });
  }

  const db = getAdminDb();
  const capped = await limitOr429(db, {
    scope: "felix",
    key: uid,
    message: "Felix is thinking. Try again shortly.",
  });
  if (capped) return capped;
  const ipCapped = await limitOr429(db, {
    scope: "felix-ip",
    key: clientIp(req),
    message: "Felix is thinking. Try again shortly.",
  });
  if (ipCapped) return ipCapped;

  const appCheckReject = await enforceAppCheck(req, "felix");
  if (appCheckReject) return appCheckReject;

  const restriction = await isRestricted(db, uid);
  if (restriction.blocked) {
    return NextResponse.json(
      { error: "account-restricted", message: "This account can't ask Felix." },
      { status: 403 }
    );
  }

  const parsed = await readJsonObject(req);
  const body: Record<string, unknown> = parsed.ok ? parsed.body : {};
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!SESSION_ID.test(sessionId)) {
    logRejectedInput("felix", "bad-session-id");
    return NextResponse.json({ error: "bad session" }, { status: 400 });
  }

  let analysis: Analysis;
  let goal = "";
  let mode: PracticeMode | undefined;
  let ref: ReturnType<NonNullable<typeof db>["doc"]> | null = null;

  if (db && uid !== "local-dev") {
    ref = db.doc(`users/${uid}/sessions/${sessionId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: "not-found", message: "That report isn't here." },
        { status: 404 }
      );
    }
    const data = snap.data() ?? {};
    if (takeIsCurrent(data.felix)) {
      return NextResponse.json({ take: data.felix, cached: true, persisted: true });
    }
    if (!looksLikeAnalysis(data.analysis)) {
      return NextResponse.json(
        { error: "no-analysis", message: "There's no analysis on this report to coach from." },
        { status: 422 }
      );
    }
    analysis = data.analysis;
    goal = sanitizeText(data.goal).slice(0, 200);
    mode = typeof data.mode === "string" ? (data.mode as PracticeMode) : undefined;
  } else {
    // No Admin SDK means no server copy of the session. In production that
    // is a misconfiguration and the honest answer is "not now", exactly as
    // the other paid routes fail closed. In local dev the session lives in
    // the browser's localStorage, so the client sends the analysis it just
    // saved, and nothing is persisted.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "unavailable", message: "Couldn't reach the server just now." },
        { status: 503 }
      );
    }
    if (!looksLikeAnalysis(body.analysis)) {
      logRejectedInput("felix", "missing-analysis");
      return NextResponse.json({ error: "nothing to coach from" }, { status: 400 });
    }
    analysis = body.analysis;
    goal = sanitizeText(body.goal).slice(0, 200);
    mode = typeof body.mode === "string" ? (body.mode as PracticeMode) : undefined;
  }

  // A sample report is invented data; a model take about it would be too.
  if (analysis.isSample) return fallback(analysis, "sample");

  // The GLOBAL daily AI spend ceiling (lib/opsMetrics.ts). Checked AFTER the
  // stored-take lookup above, deliberately: a take that already exists costs
  // nothing to serve, and a spend brake that stopped people re-reading reports
  // they have already paid for would be punishing the wrong day.
  //
  // Degrades rather than refuses — the same fallback take the route already
  // returns when the model is unavailable, assembled from the user's own
  // report. They still get thirty words from Felix, nothing is stored, and the
  // next open asks the model again. `busy` is not one of the client's final
  // reasons (lib/felixTakeClient.ts), so it isn't remembered.
  if (await overAiSpendCeiling(db)) return fallback(analysis, "busy");

  const key = geminiKey();
  if (!key) return fallback(analysis, "unconfigured");

  // The daily meter, charged only now that a paid call is certain. A cache
  // hit above never reaches here.
  if (db && uid !== "local-dev") {
    const { ok } = await reserveMeteredUse(
      db,
      uid,
      usageDateKey(""),
      "felixTakes",
      FELIX_TAKES_PER_DAY
    );
    if (!ok) {
      return NextResponse.json(
        {
          error: "rate-limited",
          message: "Felix has written a lot of takes today. He'll write more tomorrow.",
        },
        { status: 429 }
      );
    }
  }

  let text = "";
  try {
    const result = await generateJson<{ text?: string }>(key, {
      system: FELIX_TAKE_SYSTEM,
      parts: [{ text: felixTakePrompt(analysis, { goal, mode }) }],
      schema: FELIX_TAKE_SCHEMA,
      // Coaching, not creative writing: specific beats surprising.
      temperature: 0.7,
      // The take is ~100 tokens of JSON, but the 3.x models spend their
      // thinking out of the same budget: at 1000, gemini-3.5-flash handed
      // back a string cut off at the 97th character and the route fell
      // through to the next rung, six seconds later. Room to think, then
      // write.
      maxOutputTokens: 3000,
      // Leave the platform 8s to answer even if every model rung is slow.
      deadline: startedAt + (maxDuration - 8) * 1000,
    });
    text = tidyTake(result?.text);
  } catch (err) {
    // The prompt carries the user's own coaching notes; log the failure, not
    // the request.
    console.error("felix take failed:", err instanceof Error ? err.name : err);
  }
  if (wordCount(text) < FELIX_TAKE_MIN_WORDS) return fallback(analysis, "model-failed");

  // Count the call against the day's global ceiling. Counted once a take
  // exists rather than before the call: a model failure above was a Gemini
  // request we still paid for, so this undercounts by the failure rate, which
  // is well inside the rounding on the per-call cost estimate itself.
  await recordAiOperation(db, "felix");

  const take: FelixTake = {
    text,
    version: FELIX_TAKE_VERSION,
    generatedAt: Date.now(),
    source: "model",
  };

  let persisted = false;
  if (ref) {
    try {
      // Merge, never replace: the session doc is the user's whole report.
      await ref.set({ felix: take }, { merge: true });
      persisted = true;
    } catch (err) {
      // The take still goes back to the client for this open; the next open
      // simply writes again.
      console.error("felix take not saved:", err instanceof Error ? err.name : err);
    }
  }
  return NextResponse.json({ take, cached: false, persisted });
}
