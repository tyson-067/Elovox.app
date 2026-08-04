import type { NextRequest } from "next/server";

/**
 * One way in for every JSON request body.
 *
 * Every route used to open with some variant of `await req.json().catch(…)`,
 * which is correct about the thing that goes wrong most often (malformed JSON)
 * and silent about two that are worse:
 *
 *  1. SIZE. `req.json()` will happily buffer and parse whatever arrives. Only
 *     /api/analyze — the one route that expects a large body — checked
 *     Content-Length first. Every other route would parse a 50 MB object
 *     before deciding it didn't like the `action` field, which is a memory and
 *     CPU cost an unauthenticated caller could impose at will.
 *
 *  2. SHAPE. `JSON.parse("null")` and `JSON.parse("[]")` both succeed, and both
 *     produce something that is not the object the route then reads properties
 *     off. Most routes had grown their own normalisation line for this; the
 *     ones that hadn't threw on property access and answered a bare 500.
 *
 * So: check the declared size, cap the read, parse, and hand back a plain
 * object or nothing. The caller decides what to say — this never produces
 * user-facing copy, because the right sentence differs between an admin
 * console and a public form.
 *
 * `reason` is a machine code for `logRejectedInput`, never for a response.
 */

/** Default ceiling. Generous for a JSON control message, trivial to buffer. */
export const JSON_BODY_MAX_BYTES = 64 * 1024;

export type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: "too-large" | "bad-json" | "bad-shape" };

export async function readJsonObject(
  req: NextRequest,
  maxBytes: number = JSON_BODY_MAX_BYTES
): Promise<BodyResult> {
  // The declared length first — free, and it rejects the obvious case before
  // a single byte is buffered. A missing or lying header is handled by the
  // text() length check below; this is the cheap path, not the only one.
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too-large" };
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, reason: "bad-json" };
  }
  // The real check. A chunked request can omit Content-Length entirely, and a
  // dishonest one can understate it.
  if (raw.length > maxBytes) return { ok: false, reason: "too-large" };

  let parsed: unknown;
  try {
    parsed = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    return { ok: false, reason: "bad-json" };
  }

  // `null` and arrays parse fine and are not what any caller means by "the
  // body". Rejected here rather than normalised to `{}`, so a route can tell
  // "sent nothing" from "sent something wrong" if it wants to.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "bad-shape" };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}
