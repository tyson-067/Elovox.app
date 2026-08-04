import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getOpsFlags } from "@/lib/opsMetrics";
import { clientIp, makeRateLimiter } from "@/lib/verify";

// The one PUBLIC slice of ops/flags: the announcement banner. Everything
// else in the flags doc stays server-side — this returns exactly one string
// and nothing about pauses, so the endpoint reveals no operational state.
// Cached hard: at most one Firestore read a minute per instance (getOpsFlags
// caches), and CDN/browser caching keeps a banner change cheap to serve.

export const runtime = "nodejs";

// The Firestore read behind this is already capped by getOpsFlags' 60s cache,
// so the thing worth limiting is the FUNCTION INVOCATION, which the cache does
// not touch. Generous — every client polls this on load and it is CDN-cached,
// so only a loop should ever meet it.
const rateLimited = makeRateLimiter(120, 60 * 1000);

export async function GET(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return new NextResponse(null, { status: 429 });
  }
  const flags = await getOpsFlags(getAdminDb());
  return NextResponse.json(
    { banner: flags.banner || null },
    { headers: { "cache-control": "public, max-age=60, s-maxage=60" } }
  );
}
