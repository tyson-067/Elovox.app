#!/usr/bin/env node
// Proves the durable limiter does the one thing the old one couldn't: hold a
// ceiling across separate serverless instances and cold starts.
//
//   node --experimental-strip-types test-rate-limits.mjs
//   npm run test:limits
//
// "An instance" here is a fresh import of lib/rateLimit.ts, cache-busted with a
// query string so it gets its own module-level memory Map — which is exactly
// what a newly scaled-out Vercel instance gets. They all share one fake
// Firestore, as they would in production. That arrangement is the whole point:
// the limiter this replaced passed every check you could write against a single
// instance, and failed the moment there were two.

import { register } from "node:module";

// lib/rateLimit.ts imports NextResponse, which raw Node can't resolve from
// Next's exports map. A resolve hook swaps in a stand-in with the only surface
// this test touches. Defined as a data: URL so the whole test stays one file.
const LOADER = `
export async function resolve(spec, ctx, next) {
  if (spec === "next/server") {
    return {
      url: "data:text/javascript,export class NextResponse { static json(b,i){ return { body: b, status: i?.status ?? 200, headers: i?.headers ?? {} }; } }",
      shortCircuit: true,
    };
  }
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(LOADER)}`);

// .href, not .pathname: the checkout path contains a space, and round-tripping
// an already-encoded pathname back through pathToFileURL double-encodes it.
const MOD = new URL("lib/rateLimit.ts", import.meta.url).href;

/* --- A fake Firestore with real transaction semantics --------------------- */

function makeDb({ failEvery = 0 } = {}) {
  const docs = new Map();
  let txCount = 0;
  return {
    get txCount() {
      return txCount;
    },
    get docs() {
      return docs;
    },
    doc: (path) => ({ path }),
    async runTransaction(fn) {
      txCount++;
      if (failEvery && txCount % failEvery === 0) throw new Error("firestore down");
      return fn({
        async get(ref) {
          const data = docs.get(ref.path);
          return { exists: !!data, data: () => data };
        },
        set(ref, data, opts) {
          const prev = opts?.merge ? (docs.get(ref.path) ?? {}) : {};
          docs.set(ref.path, { ...prev, ...data });
        },
      });
    },
  };
}

let seq = 0;
const newInstance = () => import(`${MOD}?instance=${seq++}`);

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* --- 1. The bug that let the spike through -------------------------------- */

console.log("\nThe ceiling holds across instances:");
{
  const db = makeDb();
  let allowed = 0;
  for (let i = 0; i < 10; i++) {
    const { checkLimit } = await newInstance();
    for (let r = 0; r < 10; r++) {
      if ((await checkLimit(db, "speech", "uid-attacker")).allowed) allowed++;
    }
  }
  check(
    "10 instances x 10 requests against a 30/hour limit",
    allowed === 30,
    `${allowed} allowed; the per-instance limiter allowed 100`
  );
}

console.log("\nCold starts don't reset it:");
{
  const db = makeDb();
  const warm = await newInstance();
  for (let r = 0; r < 30; r++) await warm.checkLimit(db, "speech", "uid-cold");
  const { checkLimit } = await newInstance();
  const res = await checkLimit(db, "speech", "uid-cold");
  check("a brand new instance is still refused", !res.allowed);
  check("and says when to come back", res.retryAfterMs > 0, `${res.retryAfterMs}ms`);
}

/* --- 2. A flood must not bill us for its own rejection -------------------- */

console.log("\nWhat a flood costs:");
{
  const db = makeDb();
  const { checkLimit } = await newInstance();
  for (let r = 0; r < 5000; r++) await checkLimit(db, "speech", "uid-flood");
  check(
    "5000 requests don't cost 5000 transactions",
    db.txCount <= 31,
    `${db.txCount} transactions`
  );
}

console.log("\nBatched claims on hot paths:");
{
  const db = makeDb();
  // Read the ceiling from the table rather than hardcoding it, so tuning a
  // limit never quietly turns this into a test of nothing.
  const { LIMITS } = await newInstance();
  const { limit, batch } = LIMITS.flags;
  const attempts = limit + 100;
  let allowed = 0;
  for (let i = 0; i < 4; i++) {
    const { checkLimit } = await newInstance();
    for (let r = 0; r < attempts / 4; r++) {
      if ((await checkLimit(db, "flags", "1.2.3.4")).allowed) allowed++;
    }
  }
  check(
    "batching never exceeds the ceiling",
    allowed <= limit,
    `${allowed} allowed of ${limit}`
  );
  check(
    "batching cuts transactions",
    db.txCount <= Math.ceil(limit / batch) + 4,
    `${db.txCount} transactions for ${attempts} requests (batch ${batch})`
  );
}

/* --- 3. Windows, failure policy, isolation, privacy ----------------------- */

console.log("\nWindows roll over:");
{
  const db = makeDb();
  const { checkLimit } = await newInstance();
  const t0 = Date.now();
  for (let r = 0; r < 30; r++) await checkLimit(db, "speech", "uid-roll", t0);
  check("refused inside the window", !(await checkLimit(db, "speech", "uid-roll", t0)).allowed);
  check(
    "allowed again in the next one",
    (await checkLimit(db, "speech", "uid-roll", t0 + 3600_000)).allowed
  );
}

console.log("\nWhen Firestore itself is down:");
{
  const db = makeDb({ failEvery: 1 });
  const { checkLimit } = await newInstance();
  const quiet = console.error;
  console.error = () => {};
  const paid = await checkLimit(db, "speech", "uid-x");
  const cachedRead = await checkLimit(db, "flags", "1.2.3.4");
  console.error = quiet;
  check("a paid route fails CLOSED", !paid.allowed);
  check("a cached read route fails OPEN", cachedRead.allowed);
}

console.log("\nKeys and scopes are isolated:");
{
  const db = makeDb();
  const { checkLimit } = await newInstance();
  for (let r = 0; r < 30; r++) await checkLimit(db, "speech", "uid-a");
  check("a different user is unaffected", (await checkLimit(db, "speech", "uid-b")).allowed);
  check("a different feature is unaffected", (await checkLimit(db, "analyze", "uid-a")).allowed);
}

console.log("\nThe ledger is not a usage log:");
{
  const db = makeDb();
  const { checkLimit } = await newInstance();
  await checkLimit(db, "speech", "uid-secret-12345");
  const seen = [...db.docs.keys()].join(" ") + JSON.stringify([...db.docs.values()]);
  check("the raw uid appears nowhere in it", !seen.includes("uid-secret-12345"));
}

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(", ")}` : "")
);
process.exit(failed.length ? 1 : 0);
