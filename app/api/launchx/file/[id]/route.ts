import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clientIp } from "@/lib/verify";
import { limitOr429 } from "@/lib/rateLimit";
import { isWellFormed, readRecording } from "@/lib/launchxDelivery";

// The download side of the LaunchX delivery (lib/launchxDelivery.ts).
//
// LaunchX's endpoint is handed this URL, fetches the file once, and we delete
// our copy when it confirms. There is no signed-in user here: the 256-bit
// token in `?t=` is the credential, checked against a hash on the document.
//
// Every miss answers the same 404 (unknown id, wrong token, expired, or not
// ours), so a guess learns nothing about which part was wrong.

export const runtime = "nodejs";

function notFound(): NextResponse {
  return NextResponse.json(
    { error: "not-found" },
    { status: 404, headers: { "cache-control": "private, no-store" } }
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("t") ?? "";

  // A request that cannot possibly be one of ours is refused before it costs
  // a rate-limit write or a database read. Same body as any other miss.
  if (!isWellFormed(id, token)) return notFound();

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const limited = await limitOr429(db, {
    scope: "launchx-file",
    key: clientIp(req),
  });
  if (limited) return limited;

  const hit = await readRecording(db, id, token);
  if (!hit) return notFound();

  // Copy exactly our bytes into a fresh ArrayBuffer (a Firestore Buffer is a
  // view over a shared pool); same reason as app/api/voice/route.ts.
  const body = hit.bytes.buffer.slice(
    hit.bytes.byteOffset,
    hit.bytes.byteOffset + hit.bytes.byteLength
  ) as ArrayBuffer;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": hit.contentType,
      "content-length": String(hit.bytes.byteLength),
      "content-disposition": "attachment",
      // A student's voice: never cacheable, never sniffed into something else.
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      // The link's token is in the URL; never hand it onward as a Referer.
      "referrer-policy": "no-referrer",
    },
  });
}
