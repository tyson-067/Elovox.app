// One-off connectivity test for the LaunchX / Zite endpoints (test environment).
//
// What it does, in order:
//   1. Makes a 3-second synthetic tone as a WebM file (no real voice data).
//   2. Stages it in Firestore through lib/launchxDelivery.ts, the same code
//      the product will use, and builds the download link.
//   3. Fetches that link itself first. If the download route isn't live at
//      --base-url yet, it stops here and cleans up WITHOUT bothering LaunchX.
//   4. Asks LaunchX's receiveRecording to pull it, then sends a made-up score
//      to receiveScore.
//   5. Deletes our copy, as we do after any confirmed delivery.
//
// Usage (the test key is from Thomas's email; never commit it):
//   LAUNCHX_TEST_KEY=elx_test_... \
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/launchx-zite-test.mjs [--base-url https://elovox.app]
//
// It writes to the project's real Firestore (collection launchxDeliveries)
// using the service account in .env.local, for the one test document only.

import { readFileSync, statSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  stageRecording,
  deleteRecording,
  buildDownloadUrl,
  deliverScore,
} from "../lib/launchxDelivery.ts";

const ENDPOINT_BASE = "https://workflows.zite.com/public/f8vihtk5wq/api";
const APPLICATION_ID = "TEST-001";

const argIdx = process.argv.indexOf("--base-url");
const baseUrl = argIdx > -1 ? process.argv[argIdx + 1] : "https://elovox.app";

const apiKey = process.env.LAUNCHX_TEST_KEY;
if (!apiKey) {
  console.error("Set LAUNCHX_TEST_KEY to run the test.");
  process.exit(1);
}
// This script writes to the real Firestore and calls LaunchX; never let it
// run with a production key. (A throwaway value is fine for a dry run, which
// stops before LaunchX, but a real-looking key must be the test one.)
if (/^elx_(?!test_)/.test(apiKey)) {
  console.error("Refusing to run: that is not an elx_test_ key.");
  process.exit(1);
}
/** Anything LaunchX sends back is printed capped, with our key scrubbed. */
const safe = (s) => String(s).split(apiKey).join("[redacted]").slice(0, 300);

// --- Firestore, from the service account in .env.local --------------------
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("FIREBASE_SERVICE_ACCOUNT missing from .env.local");
  process.exit(1);
}
const raw = env.FIREBASE_SERVICE_ACCOUNT;
const svc = JSON.parse(
  raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")
);
svc.private_key = svc.private_key.replace(/\\n/g, "\n");
initializeApp({ credential: cert(svc) });
const db = getFirestore();

// --- 1. synthetic audio ---------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), "launchx-test-"));
const local = join(dir, "TEST-001-r1.webm");
execFileSync("ffmpeg", [
  "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
  "-c:a", "libopus", "-b:a", "32k", local,
]);
const bytes = new Uint8Array(readFileSync(local));
console.log(`sample file: ${statSync(local).size} bytes`);

// --- 2. stage -------------------------------------------------------------
const staged = await stageRecording(db, {
  applicationId: APPLICATION_ID,
  responseNumber: 1,
  bytes,
  contentType: "audio/webm",
});
const fileUrl = buildDownloadUrl(baseUrl, staged.id, staged.token);
console.log(`staged ${staged.id}, link expires ${new Date(staged.expiresAt).toISOString()}`);

let exitCode = 0;
try {
  // --- 3. our own pre-flight fetch ---------------------------------------
  const pre = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) });
  console.log(`pre-flight GET ${baseUrl}: ${pre.status}`);
  if (!pre.ok) {
    console.error(
      "The download route is not live at that base URL yet, so LaunchX could not fetch it either. " +
        "Deploy it (or pass --base-url) and run again. Nothing was sent to LaunchX."
    );
    exitCode = 1;
  } else {
    // --- 4. LaunchX -------------------------------------------------------
    const res = await fetch(`${ENDPOINT_BASE}/receiveRecording`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: {
          api_key: apiKey,
          application_id: APPLICATION_ID,
          response_number: 1,
          file_url: fileUrl,
          file_name: "TEST-001-r1.webm",
          content_type: "audio/webm",
          size_bytes: bytes.byteLength,
          metadata: { test: true, note: "synthetic tone, not a real recording" },
        },
      }),
    });
    console.log(`receiveRecording: ${res.status} ${safe(await res.text())}`);
    if (!res.ok) exitCode = 1;

    const score = await deliverScore(
      { endpointBase: ENDPOINT_BASE, apiKey },
      { applicationId: APPLICATION_ID, score: 72.5, maxScore: 100, metadata: { test: true } }
    );
    console.log(`receiveScore: ${score.status} ok=${score.ok} record=${score.recordId ?? "-"}`);
    if (!score.ok) exitCode = 1;
  }
} finally {
  // --- 5. cleanup ---------------------------------------------------------
  await deleteRecording(db, staged.id);
  console.log("deleted our copy");
}
process.exit(exitCode);
