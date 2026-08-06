#!/usr/bin/env node
// Fails if any API route is not durably rate limited.
//
// This exists because the bug it guards against was invisible: every route
// called a limiter, the code read as protected, and it wasn't — the limiter
// kept its counts in a per-instance Map, so the real ceiling was
// (instances x limit) and every cold start reset it. Nothing in review catches
// that, because the call site of a limiter that works and one that doesn't
// look identical. So it gets checked mechanically instead.
//
//   node audit-rate-limits.mjs      (also: npm run audit:limits)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the checkout path contains a space, which
// pathname hands back percent-encoded and every fs call then fails on.
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const API = join(ROOT, "app/api");

/** Every scope declared in the LIMITS table. */
function declaredScopes() {
  const src = readFileSync(join(ROOT, "lib/rateLimit.ts"), "utf8");
  const table = src.slice(
    src.indexOf("export const LIMITS"),
    src.indexOf("} as const satisfies")
  );
  return new Set(
    [...table.matchAll(/^\s*"?([a-z][a-z0-9-]*)"?:\s*\{\s*limit:/gm)].map((m) => m[1])
  );
}

function routeFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out.sort();
}

const scopes = declaredScopes();
const problems = [];
const used = new Set();
let checked = 0;

for (const file of routeFiles(API)) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  checked++;

  // Which HTTP methods does this route actually export?
  const methods = [
    ...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g),
  ].map((m) => m[1]);
  if (!methods.length) continue;

  // `rateLimitIp` counts: /api/auth/login has its own durable per-IP limiter
  // in lib/loginGuard.ts, kept separate on purpose. A login refusal must be
  // indistinguishable from a wrong password, so it cannot carry Retry-After or
  // a distinct body the way limitOr429 does — the header would re-open the
  // enumeration oracle the whole route is built to close.
  const calls = [...src.matchAll(/\b(?:limited|limitOr429|rateLimitIp)\(/g)].length;
  const inline = [...src.matchAll(/scope:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  const positional = [...src.matchAll(/\blimited\([^,]+,\s*"([a-z0-9-]+)"/g)].map(
    (m) => m[1]
  );

  if (calls === 0) {
    problems.push(`${rel}: exports ${methods.join("/")} but never rate limits`);
    continue;
  }

  for (const s of [...inline, ...positional]) {
    used.add(s);
    if (!scopes.has(s)) problems.push(`${rel}: unknown scope "${s}"`);
  }

  // The original bug, so it gets its own check: a route must not go back to
  // counting in a Map. lib/auth/login is the one sanctioned exception, where
  // it is a documented prefilter in FRONT of a durable per-IP limit.
  if (/makeRateLimiter/.test(src) && !rel.includes("auth/login")) {
    problems.push(`${rel}: uses makeRateLimiter (per-instance, not a ceiling)`);
  }
}

for (const s of scopes) {
  if (!used.has(s)) problems.push(`LIMITS."${s}" is declared but never used`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  process.exit(1);
}

console.log(`✓ ${checked} routes checked, ${scopes.size} scopes, all durably limited`);
