// Handing a LaunchX candidate's recording to LaunchX, and our copy going away.
//
// LaunchX asked for a pull, not a push: we POST a small JSON request holding a
// download link, their endpoint (a Zite workflow) fetches the file into its
// own storage immediately, and we delete ours. See the thread with Thomas
// Clapper. Elovox never retains the audio; this module is the only place a
// recording rests on our side, and only until LaunchX confirms it has it.
//
// Where it rests: a Firestore document, the same trick /api/voice uses for
// Felix's clips. Firebase Storage is not enabled on this project, and a take
// is capped at 45 seconds, so it fits a document comfortably (the cap below
// is the same 700 KB /api/voice uses, leaving headroom under Firestore's
// 1 MiB document limit for the other fields).
//
// The link is the credential. It carries a 256-bit random token; only its
// SHA-256 is stored, so a read of the collection cannot be turned back into
// working links. The collection is deny-all to clients in firestore.rules
// (it falls under the catch-all), so only the Admin SDK ever touches it.
//
// No imports from the rest of the app on purpose: scripts/launchx-zite-test.mjs
// loads this file directly under node's type-stripping, which cannot resolve
// the "@/" alias or extensionless relative paths. The database is passed in.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

/** Server-only collection; deny-all to clients via the catch-all rule. */
export const COLLECTION = "launchxDeliveries";

/** LaunchX needs the link live for about 24 hours. */
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** Same ceiling as the Felix voice cache; see the header for why. */
export const MAX_RECORDING_BYTES = 700 * 1024;

/** The formats LaunchX's endpoint accepts. */
export const ALLOWED_CONTENT_TYPES = [
  "audio/webm",
  "video/webm",
  "audio/mp4",
  "video/mp4",
  "audio/x-m4a",
  "video/quicktime",
] as const;

export type DeliveryErrorCode =
  | "bad-application-id"
  | "bad-response-number"
  | "bad-content-type"
  | "empty"
  | "too-large";

export class DeliveryError extends Error {
  code: DeliveryErrorCode;
  constructor(code: DeliveryErrorCode, message: string) {
    super(message);
    this.name = "DeliveryError";
    this.code = code;
  }
}

/**
 * Once LaunchX has fetched a link successfully, how much longer it stays
 * live. LaunchX confirms the pull in the same breath, and we delete on that
 * confirmation; this is only the backstop for a confirmation that never
 * arrives (timeout, their error after the download), so the link stops
 * being replayable for a day and lingers for minutes instead.
 */
export const REFETCH_WINDOW_MS = 10 * 60 * 1000;

/** A document id is `<16 hex>-r<n>`; anything else is not one of ours. */
export const DELIVERY_ID = /^[a-f0-9]{16}-r\d{1,2}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Shape check only, so a malformed request can be refused before any read. */
export function isWellFormed(id: string, token: string): boolean {
  return DELIVERY_ID.test(id) && TOKEN.test(token);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Stable per (application, response), so staging the same response twice
 * replaces the first copy, matching how LaunchX's endpoint treats a resend.
 * The application id is hashed because it is theirs and may hold characters a
 * document id should not.
 */
export function deliveryId(applicationId: string, responseNumber: number): string {
  return `${sha256(applicationId).slice(0, 16)}-r${responseNumber}`;
}

export function buildDownloadUrl(baseUrl: string, id: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/launchx/file/${id}?t=${token}`;
}

export interface StageInput {
  applicationId: string;
  responseNumber: number;
  bytes: Uint8Array;
  contentType: string;
  /** Epoch ms; injectable for tests. */
  now?: number;
}

export interface Staged {
  id: string;
  token: string;
  expiresAt: number;
}

/** Validate and store one recording, returning the id and secret token. */
export async function stageRecording(db: Firestore, input: StageInput): Promise<Staged> {
  // The type is only a promise from the caller; a non-string must be a
  // DeliveryError, not a TypeError out of .trim().
  const applicationId =
    typeof input.applicationId === "string" ? input.applicationId.trim() : "";
  if (!applicationId || applicationId.length > 128) {
    throw new DeliveryError("bad-application-id", "application id must be 1-128 characters");
  }
  const n = input.responseNumber;
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new DeliveryError("bad-response-number", "response number must be 1-10");
  }
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    throw new DeliveryError("bad-content-type", `unsupported content type ${input.contentType}`);
  }
  if (input.bytes.byteLength === 0) {
    throw new DeliveryError("empty", "recording is empty");
  }
  if (input.bytes.byteLength > MAX_RECORDING_BYTES) {
    throw new DeliveryError("too-large", `recording is over ${MAX_RECORDING_BYTES} bytes`);
  }

  const now = input.now ?? Date.now();
  const id = deliveryId(applicationId, n);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + LINK_TTL_MS;

  await db.collection(COLLECTION).doc(id).set({
    applicationId,
    responseNumber: n,
    contentType: input.contentType,
    bytes: Buffer.from(input.bytes),
    tokenHash: sha256(token),
    createdAt: now,
    expiresAt,
  });
  return { id, token, expiresAt };
}

function asBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

/**
 * The recording for a link, or null. Unknown id, wrong token, and expired all
 * return the same null so the caller cannot tell a guess that found a real
 * document from one that did not.
 *
 * Order matters, and each step is chosen so a stranger gets as little as
 * possible:
 *   1. Read ONLY the small fields (a field mask), never the audio, so a wrong
 *      guess costs a few bytes of read instead of up to 700 KB.
 *   2. Check the token before anything else. Expiry and deletion come after,
 *      so an unauthenticated caller can neither learn that a document is
 *      expired nor trigger a write.
 *   3. Only then fetch the audio, and shorten the link's remaining life, so
 *      the link is effectively single-use even if the confirmation to LaunchX
 *      never lands.
 */
export async function readRecording(
  db: Firestore,
  id: string,
  token: string,
  now: number = Date.now()
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!isWellFormed(id, token)) return null;
  const ref = db.collection(COLLECTION).doc(id);

  const [meta] = await db.getAll(ref, {
    fieldMask: ["tokenHash", "expiresAt", "contentType"],
  });
  if (!meta.exists) return null;
  const m = meta.data() ?? {};

  const stored = typeof m.tokenHash === "string" ? m.tokenHash : "";
  const a = Buffer.from(stored);
  const b = Buffer.from(sha256(token));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Token is genuine from here on, so acting on the document is authorised.
  if (typeof m.expiresAt !== "number" || m.expiresAt <= now) {
    await ref.delete().catch(() => undefined);
    return null;
  }

  const full = await ref.get();
  const bytes = asBytes(full.data()?.bytes);
  if (!bytes || typeof m.contentType !== "string") return null;

  await ref
    .update({ fetchedAt: now, expiresAt: Math.min(m.expiresAt, now + REFETCH_WINDOW_MS) })
    .catch(() => undefined);
  return { bytes, contentType: m.contentType };
}

/**
 * Delete our copy, but only if it is still the one we staged. Two deliveries
 * of the same response share a document id (so a resend replaces rather than
 * duplicates), which means the first one's success must not delete the
 * second one's fresh copy.
 */
export async function deleteRecordingIfCurrent(
  db: Firestore,
  id: string,
  token: string
): Promise<boolean> {
  const ref = db.collection(COLLECTION).doc(id);
  const [meta] = await db.getAll(ref, { fieldMask: ["tokenHash"] });
  if (!meta.exists || meta.data()?.tokenHash !== sha256(token)) return false;
  await ref.delete();
  return true;
}

/** Plain delete by id, for the test script, which owns the document it made. */
export async function deleteRecording(db: Firestore, id: string): Promise<void> {
  await db.collection(COLLECTION).doc(id).delete();
}

/**
 * Remove every staged recording whose link has expired, whether or not anyone
 * ever asked for it. This is the real enforcement of "we do not keep the
 * audio": without it, a delivery LaunchX never fetched would sit here
 * forever. Called from the daily purge cron (app/api/cron/purge-ops) because
 * a Firestore TTL policy needs an IAM grant the console answers 403 to.
 * Selects no fields, so a sweep never loads audio into memory.
 */
export async function purgeExpiredLaunchxDeliveries(
  db: Firestore,
  limit = 200,
  now: number = Date.now()
): Promise<number> {
  const snap = await db
    .collection(COLLECTION)
    .where("expiresAt", "<=", now)
    .select()
    .limit(limit)
    .get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

export interface LaunchxTarget {
  /** e.g. https://workflows.zite.com/public/<id>/api (no trailing slash) */
  endpointBase: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

async function postToLaunchx(
  target: LaunchxTarget,
  name: "receiveRecording" | "receiveScore",
  inputs: Record<string, unknown>
): Promise<{ ok: boolean; status: number; recordId?: string; message?: string }> {
  // The body carries the API key, so it only ever goes over TLS ...
  if (!/^https:\/\//i.test(target.endpointBase)) {
    throw new Error("LaunchX endpoint must be an https URL");
  }
  const f = target.fetchImpl ?? fetch;
  const res = await f(`${target.endpointBase.replace(/\/+$/, "")}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: { api_key: target.apiKey, ...inputs } }),
    // ... and a redirect is an error, not something to follow: a 307/308
    // would replay that body, key included, to whatever host it names.
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  let body: { ok?: boolean; record_id?: unknown; message?: unknown; error?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page; the status is what matters.
  }
  // LaunchX's message says which field was wrong. It is remote text, so it is
  // coerced, capped, and scrubbed of our key before it can reach a log.
  const raw = body.message ?? body.error;
  const message =
    typeof raw === "string"
      ? raw.split(target.apiKey).join("[redacted]").slice(0, 200)
      : undefined;
  return {
    ok: res.ok && body.ok === true,
    status: res.status,
    recordId: typeof body.record_id === "string" ? body.record_id : undefined,
    message,
  };
}

export interface DeliverInput extends StageInput {
  /** Public origin LaunchX can reach, e.g. https://elovox.app */
  baseUrl: string;
  fileName?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Stage a recording, ask LaunchX to pull it, and delete our copy once they
 * confirm. On any failure the copy stays (until its 24 hours are up) so the
 * delivery can be retried; a retry replaces it rather than duplicating.
 */
export async function deliverRecording(
  db: Firestore,
  target: LaunchxTarget,
  input: DeliverInput
): Promise<{ ok: boolean; status: number; recordId?: string; message?: string; id: string }> {
  const staged = await stageRecording(db, input);
  const result = await postToLaunchx(target, "receiveRecording", {
    application_id: input.applicationId.trim(),
    response_number: input.responseNumber,
    file_url: buildDownloadUrl(input.baseUrl, staged.id, staged.token),
    ...(input.fileName ? { file_name: input.fileName } : {}),
    content_type: input.contentType,
    size_bytes: input.bytes.byteLength,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  if (result.ok) await deleteRecordingIfCurrent(db, staged.id, staged.token);
  return { ...result, id: staged.id };
}

export async function deliverScore(
  target: LaunchxTarget,
  input: {
    applicationId: string;
    score: number;
    maxScore?: number;
    metadata?: Record<string, unknown>;
  }
) {
  return postToLaunchx(target, "receiveScore", {
    application_id: input.applicationId.trim(),
    score: input.score,
    ...(input.maxScore !== undefined ? { max_score: input.maxScore } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}
