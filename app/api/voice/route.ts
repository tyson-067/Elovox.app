import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  verifyVerifiedUser,
  enforceAppCheck,
  logRejectedInput,
  clientIp,
} from "@/lib/verify";
import { limitOr429 } from "@/lib/rateLimit";
import { sanitizeText } from "@/lib/validation";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isRestricted } from "@/lib/moderation";
import { usageDateKey, reserveMeteredUse } from "@/lib/quota";
import { readJsonObject } from "@/lib/requestBody";
import { takeIsCurrent } from "@/lib/felixTake";
import {
  FishAudioError,
  fishAudioKey,
  fishAudioModel,
  fishAudioVoiceId,
  synthesize,
  VOICE_TEXT_MAX,
} from "@/lib/fishAudio";

// Felix's voice: MP3 out, via Fish Audio. Two ways in:
//
//   POST { sessionId }   Felix's take on one of the caller's own sessions.
//                        The text is read from the session doc (never from
//                        the request), and the bytes are cached on the doc's
//                        felix/voice subdocument, so a replay on any device
//                        costs a Firestore read and never a second synthesis.
//   POST { text }        A line to read. No cache; the browser keeps its own
//                        decoded copy (lib/felixVoice.ts) for replays.
//
// The landing page never calls this: its sample is a static file written
// once by scripts/felix-voice-sample.mjs, so a stranger can hear him for
// free and nobody can spend our Fish Audio budget from the front door.
//
// Same guard order as /api/speech, for the same reasons: who (verified
// user), how often (hourly per user and per IP), from where (App Check),
// whether they're in good standing (moderation), then the durable daily
// meter charged immediately before the paid call. A cache hit is served
// before the meter and costs nothing.

export const runtime = "nodejs";
export const maxDuration = 30;

/** Durable per-user daily ceiling on the Fish Audio meter. */
const VOICE_GENS_PER_DAY = 200;

/** A shade brisk. Felix coaches; he does not read bedtime stories. */
const FELIX_SPEED = 1.04;

/**
 * Cache ceiling. A Firestore document holds 1 MiB; a take is ~150 KB at the
 * 64 kbps the client asks for, and the longest line this route will read is
 * still under this. Anything bigger is served and simply not cached.
 */
const VOICE_CACHE_MAX_BYTES = 700 * 1024;

const SESSION_ID = /^[A-Za-z0-9_-]{1,120}$/;

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function audio(bytes: Uint8Array, cached: boolean): NextResponse {
  // A Firestore Buffer is a view over a shared pool, and a Uint8Array over a
  // SharedArrayBuffer isn't a BodyInit as far as the types go. Copy exactly
  // the bytes that are ours into a fresh ArrayBuffer and send that.
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(bytes.byteLength),
      // Personal report text in, so never shared-cacheable.
      "cache-control": "private, no-store",
      "x-felix-voice": cached ? "cached" : "fresh",
    },
  });
}

/**
 * The cached bytes come back from Firestore as a Buffer. `instanceof
 * Uint8Array` is a realm check and Buffer is not always from ours (it isn't
 * under vitest's jsdom), so ask the one question that crosses realms:
 * is this a view over an ArrayBuffer?
 */
function asBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
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
    scope: "voice",
    key: uid,
    message: "Felix needs a sip of water. Try again shortly.",
  });
  if (capped) return capped;
  const ipCapped = await limitOr429(db, {
    scope: "voice-ip",
    key: clientIp(req),
    message: "Felix needs a sip of water. Try again shortly.",
  });
  if (ipCapped) return ipCapped;

  const appCheckReject = await enforceAppCheck(req, "voice");
  if (appCheckReject) return appCheckReject;

  const restriction = await isRestricted(db, uid);
  if (restriction.blocked) {
    return NextResponse.json(
      { error: "account-restricted", message: "This account can't use Felix's voice." },
      { status: 403 }
    );
  }

  const parsed = await readJsonObject(req);
  const body: Record<string, unknown> = parsed.ok ? parsed.body : {};
  const sessionId =
    typeof body.sessionId === "string" && SESSION_ID.test(body.sessionId) ? body.sessionId : "";

  let text = "";
  let cacheRef: ReturnType<NonNullable<typeof db>["doc"]> | null = null;

  if (sessionId && db && uid !== "local-dev") {
    // The stored take wins over anything the request said: a session is
    // voiced with the words on its own document, not with words posted to
    // this route. That is not the same as trusting them — the document is
    // client-writable (firestore.rules bounds the field, it does not author
    // it), so the text off it is treated exactly like text off the wire.
    const snap = await db.doc(`users/${uid}/sessions/${sessionId}`).get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: "not-found", message: "That report isn't here." },
        { status: 404 }
      );
    }
    const take = snap.data()?.felix;
    if (!takeIsCurrent(take)) {
      return NextResponse.json(
        { error: "no-take", message: "Felix hasn't written his take on this one yet." },
        { status: 409 }
      );
    }
    // Same sanitise-and-cap as the request-text branch below, for the same
    // reason: this string reaches Fish Audio, which charges by the
    // character. takeIsCurrent already refuses anything over
    // FELIX_TAKE_MAX_WORDS, but words are not bytes — seventy pasted words
    // can still be a hundred kilobytes — and the daily meter caps how MANY
    // syntheses a user buys, never how big each one is.
    text = sanitizeText(take.text).slice(0, VOICE_TEXT_MAX);
    if (!text) {
      return NextResponse.json(
        { error: "no-take", message: "Felix hasn't written his take on this one yet." },
        { status: 409 }
      );
    }
    cacheRef = db.doc(`users/${uid}/sessions/${sessionId}/felix/voice`);
    const cached = await cacheRef.get().catch(() => null);
    const hit = cached?.exists ? cached.data() : undefined;
    const bytes = asBytes(hit?.bytes);
    // A clip is only this take, in THIS voice, from THIS model. The text
    // alone isn't enough: changing FISH_AUDIO_VOICE_ID gives Felix a new
    // voice for every new report and left every already-heard one playing
    // the old one for good, which is a voice change that only half happens.
    // Both are stored on the write below, so an old clip simply misses and
    // is re-synthesized once, on the next play, and replaced.
    if (
      hit &&
      bytes &&
      hit.textHash === textHash(text) &&
      (hit.voiceId ?? null) === (fishAudioVoiceId() ?? null) &&
      hit.model === fishAudioModel()
    ) {
      return audio(bytes, true);
    }
  } else {
    // Free text that came from our own model, but through the client, so it
    // gets the same treatment as anything a user could have typed. In local
    // dev a sessionId can't be resolved (no Admin SDK), so the take's text
    // travels alongside it and lands here.
    text = sanitizeText(body.text).slice(0, VOICE_TEXT_MAX);
    if (!text) {
      logRejectedInput("voice", "missing-text");
      return NextResponse.json({ error: "nothing to say" }, { status: 400 });
    }
  }

  const key = fishAudioKey();
  if (!key) {
    return NextResponse.json(
      {
        error: "voice-unavailable",
        message: "Felix's voice isn't set up on this server yet.",
      },
      { status: 503 }
    );
  }

  // The daily meter, charged as late as possible: only once the request is
  // known to be valid and about to cost something. No refund path; a failed
  // synthesis is a few cents and a retry.
  if (db && uid !== "local-dev") {
    const { ok } = await reserveMeteredUse(
      db,
      uid,
      usageDateKey(""),
      "voiceGens",
      VOICE_GENS_PER_DAY
    );
    if (!ok) {
      return NextResponse.json(
        {
          error: "rate-limited",
          message: "Felix has talked enough for one day. He'll read again tomorrow.",
        },
        { status: 429 }
      );
    }
  } else if (!db && process.env.NODE_ENV === "production") {
    // Without the Admin SDK the daily meter can't be enforced. Fail closed
    // in production, exactly as /api/speech does.
    return NextResponse.json(
      { error: "unavailable", message: "Couldn't reach the server just now." },
      { status: 503 }
    );
  }

  try {
    const synthesized = await synthesize(key, {
      text,
      voiceId: fishAudioVoiceId(),
      model: fishAudioModel(),
      speed: FELIX_SPEED,
      // Leave the platform 6s to answer even if Fish Audio uses the lot.
      timeoutMs: Math.max(5_000, (maxDuration - 6) * 1000 - (Date.now() - startedAt)),
    });
    const bytes = new Uint8Array(synthesized);

    if (cacheRef && bytes.byteLength <= VOICE_CACHE_MAX_BYTES) {
      // Best effort: a cache that can't be written is a replay that costs a
      // synthesis, not a take that can't be heard.
      await cacheRef
        .set({
          bytes: Buffer.from(bytes),
          textHash: textHash(text),
          contentType: "audio/mpeg",
          byteLength: bytes.byteLength,
          model: fishAudioModel(),
          voiceId: fishAudioVoiceId() ?? null,
          cachedAt: Date.now(),
        })
        .catch((err: unknown) => {
          console.error("voice cache write failed:", err instanceof Error ? err.name : err);
        });
    }
    return audio(bytes, false);
  } catch (err) {
    // The upstream body can echo our request; log the status, not the text.
    if (err instanceof FishAudioError) {
      console.error(`voice synthesis failed: fish audio ${err.status}`);
    } else {
      console.error("voice synthesis failed:", err instanceof Error ? err.name : err);
    }
    return NextResponse.json(
      { error: "voice-failed", message: "Felix couldn't read that just now. Try again in a moment." },
      { status: 502 }
    );
  }
}
