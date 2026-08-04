import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, makeRateLimiter, clientIp } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { sanitizeText } from "@/lib/validation";

// Editorial control over the Daily Minute — the one piece of content every
// user shares. /api/daily auto-generates a topic the first time a day is
// requested; this route lets an operator SEE the pipeline's output and, for
// FUTURE days, set or clear the topic by hand (a themed week, a fix for a
// clunker, a planned launch tie-in). Shared editorial content, no user data
// anywhere near it.
//
// THE INVARIANT THIS ROUTE MUST KEEP: one shared topic per day, immutable
// once people have played it. Scores compare against the same prompt, warm
// instances memoize the day, and clients cache it by date — so TODAY and the
// past are read-only here. Tomorrow onward is fair game: nothing has been
// scored, nothing is cached (the client cache is date-keyed and the day
// hasn't started), and /api/daily's create-only publish simply finds the doc
// already present and serves it.
//
// GET  → the surrounding window (yesterday .. +7 days), whatever exists.
// POST → set a FUTURE day's challenge (full shape, three bullets).
// DELETE → clear a FUTURE day's doc so auto-generation runs after all.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(30);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead an operator can schedule. Two weeks is planning, not drift. */
const MAX_AHEAD_DAYS = 14;

function utcKey(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from today (UTC) to `date`; NaN when unparseable. */
function daysFromToday(date: string): number {
  const t = Date.parse(`${utcKey(0)}T00:00:00Z`);
  const d = Date.parse(`${date}T00:00:00Z`);
  return Math.round((d - t) / DAY_MS);
}

export async function GET(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/daily", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const keys = Array.from({ length: 9 }, (_, i) => utcKey(i - 1)); // -1 .. +7
  const snaps = await db.getAll(
    ...keys.map((k) => db.doc(`dailyChallenges/${k}`))
  );
  const days = snaps.map((snap, i) => {
    const d = snap.exists ? (snap.data() ?? {}) : null;
    return {
      date: keys[i],
      exists: snap.exists,
      editable: daysFromToday(keys[i]) >= 1,
      title: typeof d?.title === "string" ? d.title : null,
      topic: typeof d?.topic === "string" ? d.topic : null,
      scenario: typeof d?.scenario === "string" ? d.scenario : null,
      bullets: Array.isArray(d?.bullets)
        ? d.bullets.filter((b: unknown): b is string => typeof b === "string")
        : null,
      focus: typeof d?.focus === "string" ? d.focus : null,
      theme: typeof d?.theme === "string" ? d.theme : null,
      generated: d?.generated === true,
    };
  });

  return NextResponse.json(
    { generatedAt: Date.now(), days },
    { headers: { "cache-control": "private, no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/daily", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed;
    }
  } catch {
    // falls through to validation below
  }

  const date = typeof body.date === "string" ? body.date : "";
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Bad date." }, { status: 400 });
  }
  const ahead = daysFromToday(date);
  if (!Number.isFinite(ahead) || ahead < 1 || ahead > MAX_AHEAD_DAYS) {
    return NextResponse.json(
      {
        error: `Only future days can be set — tomorrow through ${MAX_AHEAD_DAYS} days out. Today is already live for someone.`,
      },
      { status: 400 }
    );
  }

  // Same sanitation the analyze route applies to user text: this lands in a
  // doc every client renders and /api/analyze interpolates into a prompt.
  const title = sanitizeText(body.title).slice(0, 60).trim();
  const topic = sanitizeText(body.topic).slice(0, 200).trim();
  const scenario = sanitizeText(body.scenario).slice(0, 300).trim();
  const focus = sanitizeText(body.focus).slice(0, 200).trim();
  const bullets = Array.isArray(body.bullets)
    ? body.bullets
        .map((b) => sanitizeText(b).slice(0, 120).trim())
        .filter(Boolean)
    : [];
  if (!title || !topic || !scenario || !focus || bullets.length !== 3) {
    return NextResponse.json(
      {
        error:
          "Needs title, topic, scenario, focus, and exactly three bullets.",
      },
      { status: 400 }
    );
  }

  await db.doc(`dailyChallenges/${date}`).set({
    date,
    title,
    topic,
    scenario,
    bullets,
    focus,
    theme: "Operator pick",
    // True on purpose: clients treat generated:false as a fallback they must
    // not cache or trust as the shared topic. An operator pick IS the day's
    // real, shared challenge.
    generated: true,
  });

  await recordAdminAction(db, {
    action: "daily.set",
    actor: admin.email,
    detail: { date, title, topic },
  });

  return NextResponse.json({ ok: true, date });
}

export async function DELETE(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/daily", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed;
    }
  } catch {
    // falls through to validation below
  }
  const date = typeof body.date === "string" ? body.date : "";
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Bad date." }, { status: 400 });
  }
  const ahead = daysFromToday(date);
  if (!Number.isFinite(ahead) || ahead < 1) {
    return NextResponse.json(
      { error: "Only future days can be cleared — today is already live." },
      { status: 400 }
    );
  }

  await db.doc(`dailyChallenges/${date}`).delete();

  await recordAdminAction(db, {
    action: "daily.clear",
    actor: admin.email,
    detail: { date },
  });

  return NextResponse.json({ ok: true, date });
}
