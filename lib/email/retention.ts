/**
 * Retention for the delivery log.
 *
 * `emailLog` holds addresses — it has to, that is what makes "did this user's
 * receipt bounce?" answerable — which puts it squarely inside the privacy
 * policy's promise that logs live "a short operational window, then
 * discarded". Thirty days is that window: long enough to investigate a
 * delivery complaint from last month, short enough that this never becomes a
 * standing copy of the user table.
 *
 * The counters in `emailBudget` are NOT swept. They hold no addresses and no
 * uids, only totals, and the year-long shape of them is the only early
 * warning anyone gets that the free plan is running out.
 *
 * Same idempotent, reconcile-against-now design as lib/opsMetrics.ts' purge:
 * a missed day is picked up by the next run, a double run deletes nothing
 * extra. Called from the existing daily cron.
 */

import { Timestamp, type Firestore } from "firebase-admin/firestore";

export async function purgeExpiredEmailLog(
  db: Firestore | null,
  limit = 300
): Promise<number> {
  if (!db) return 0;
  try {
    // Two queries for the same reason the ops purge needs two: Firestore
    // range comparisons are type-scoped, so a `< Timestamp` bound silently
    // matches zero numeric rows. This collection writes numbers today; the
    // Timestamp query costs one empty read and covers the day it doesn't.
    const [numeric, stamped] = await Promise.all([
      db.collection("emailLog").where("expiresAt", "<", Date.now()).limit(limit).get(),
      db
        .collection("emailLog")
        .where("expiresAt", "<", Timestamp.now())
        .limit(limit)
        .get(),
    ]);
    const seen = new Set<string>();
    const docs = [...numeric.docs, ...stamped.docs].filter((d) => {
      if (seen.has(d.ref.path)) return false;
      seen.add(d.ref.path);
      return true;
    });
    if (docs.length === 0) return 0;
    const batch = db.batch();
    for (const doc of docs) batch.delete(doc.ref);
    await batch.commit();
    return docs.length;
  } catch (err) {
    console.error("[mail] log purge failed", err);
    return 0;
  }
}
