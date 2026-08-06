import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getOpsFlags } from "@/lib/opsMetrics";
import { clientIp } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";

// The one PUBLIC slice of ops/flags: the announcement banner. Everything
// else in the flags doc stays server-side — this returns exactly one string
// and nothing about pauses, so the endpoint reveals no operational state.
// Cached hard: at most one Firestore read a minute per instance (getOpsFlags
// caches), and CDN/browser caching keeps a banner change cheap to serve.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (await limited(getAdminDb(), "flags", clientIp(req))) {
    return new NextResponse(null, { status: 429 });
  }
  const flags = await getOpsFlags(getAdminDb());
  return NextResponse.json(
    { banner: flags.banner || null },
    { headers: { "cache-control": "public, max-age=60, s-maxage=60" } }
  );
}
