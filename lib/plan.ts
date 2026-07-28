"use client";

import { useEffect, useRef, useState } from "react";
import { isFirebaseConfigured, getDb, getUser } from "./firebase";

// Entitlements. One flag, free or premium, read from Firestore at
// users/{uid}/profile/plan, cached in localStorage so gated UI doesn't
// flash on every navigation.
//
// The Stripe webhook (/api/stripe/webhook) is the only writer of that doc —
// it sets `plan` from the live subscription status. For testing without a
// subscription, use the dev override below or edit Firestore directly.

export type Plan = "free" | "premium";

// Subscription status, mirrored from Stripe by the webhook. `plan` above is
// the derived entitlement bit the whole UI reads; `status` is the richer
// state the billing screens use (trial countdown, dunning prompts, "active
// until…" after a cancel).
export type SubStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "none";

export interface PlanRecord {
  plan: Plan; // derived entitlement: what gates read
  status?: SubStatus; // raw Stripe subscription status
  cycle?: "weekly" | "monthly" | "annual";
  since?: number; // epoch ms the subscription started
  trialEnd?: number; // epoch ms the trial ends (while trialing)
  currentPeriodEnd?: number; // epoch ms the paid period / access ends
  cancelAtPeriodEnd?: boolean; // canceled but still active until period end
  cancelAt?: number; // epoch ms access ends, when Stripe set an explicit date
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

const cacheKey = (uid: string) => `elovox.plan.${uid}`;

/**
 * How long a cached entitlement is trusted before we ask Firestore again.
 *
 * The cache exists so gated UI doesn't flicker on every navigation, and a few
 * minutes is plenty for that. It must expire, though: this used to be stored
 * with no lifetime at all, so the first answer won was permanent. Anyone who
 * finished Checkout a moment before the webhook landed cached "free" and
 * stayed locked out of what they'd just paid for, on that device, forever —
 * with no way back short of clearing site data. (Seen in production.)
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  plan: Plan;
  at: number;
}

/** Whatever is cached, fresh or not, or null if there's nothing usable. */
function readCacheEntry(uid: string): CacheEntry | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    // Entries written before the TTL existed are bare strings; they carry no
    // timestamp, so treat them as infinitely stale rather than discarding
    // them: stale is still a better answer than a wrong "free".
    const parsed = JSON.parse(raw) as { plan?: unknown; at?: unknown };
    if (parsed?.plan !== "premium" && parsed?.plan !== "free") return null;
    return { plan: parsed.plan, at: typeof parsed.at === "number" ? parsed.at : 0 };
  } catch {
    // Storage blocked, or a malformed entry.
    return null;
  }
}

/** Cached plan if one is present and still fresh, else null. */
function readCache(uid: string): Plan | null {
  const entry = readCacheEntry(uid);
  if (!entry) return null;
  return Date.now() - entry.at > CACHE_TTL_MS ? null : entry.plan;
}

function writeCache(uid: string, plan: Plan): void {
  try {
    window.localStorage.setItem(
      cacheKey(uid),
      JSON.stringify({ plan, at: Date.now() })
    );
  } catch {
    // non-fatal
  }
}

// Local testing escape hatch: set NEXT_PUBLIC_FORCE_PLAN=premium in
// .env.local to see every gated surface without a Stripe subscription.
function forcedPlan(): Plan | null {
  const forced = process.env.NEXT_PUBLIC_FORCE_PLAN;
  return forced === "premium" || forced === "free" ? forced : null;
}

async function currentUid(): Promise<string> {
  if (!isFirebaseConfigured()) return "local";
  const user = await getUser();
  return user?.uid ?? "local";
}

/**
 * In-flight Firestore read, shared across every hook that asks at the same
 * moment. A dashboard renders four or five `usePlan()` consumers at once and
 * they used to fire four or five identical reads on every cold navigation.
 */
let inFlight: { uid: string; promise: Promise<Plan> } | null = null;

/** Mounted `usePlan` consumers, so a refresh reaches all of them at once. */
const planListeners = new Set<(plan: Plan) => void>();

function broadcast(plan: Plan): void {
  planListeners.forEach((l) => l(plan));
}

async function readPlanFromFirestore(uid: string): Promise<Plan> {
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(getDb(), "users", uid, "profile", "plan"));
  return snap.exists() && snap.data().plan === "premium" ? "premium" : "free";
}

export async function getPlan(): Promise<Plan> {
  const forced = forcedPlan();
  if (forced) return forced;

  const uid = await currentUid();

  const cached = readCache(uid);
  if (cached) return cached;
  if (uid === "local") return "free";

  if (inFlight?.uid === uid) return inFlight.promise;

  const promise = (async () => {
    try {
      const plan = await readPlanFromFirestore(uid);
      writeCache(uid, plan);
      return plan;
    } catch {
      // Firestore unreachable. This used to return "free", which is where
      // Premium visibly disappeared mid-session: one flaky read after the
      // 5-minute cache expired and a paying subscriber watched every gated
      // surface lock, then unlock again a few clicks later when the next
      // read happened to succeed.
      //
      // A network failure is not evidence that someone stopped paying, so
      // the last answer we actually got from Firestore stands, however old
      // it is. The cache is not re-stamped, so the next navigation still
      // retries rather than pinning this forever. With nothing cached at
      // all we have never seen an entitlement, and "free" is the safe
      // direction: the server enforces the real boundary on every gated
      // route regardless of what this returns.
      return readCacheEntry(uid)?.plan ?? "free";
    } finally {
      if (inFlight?.uid === uid) inFlight = null;
    }
  })();

  inFlight = { uid, promise };
  return promise;
}

/**
 * Clears the cached plan so the next read hits Firestore. Call this after
 * returning from Stripe checkout, where the webhook has just upgraded the
 * user but the cache still says "free".
 */
export async function refreshPlan(): Promise<Plan> {
  const uid = await currentUid();
  try {
    window.localStorage.removeItem(cacheKey(uid));
  } catch {
    // non-fatal
  }
  inFlight = null;
  const plan = await getPlan();
  // Push it to every mounted consumer, so returning from Checkout unlocks
  // the header, the sub-nav and the page body together rather than
  // whichever one happens to remount first.
  broadcast(plan);
  return plan;
}

/**
 * Plan for the signed-in user. `null` while loading, so gated UI can hold
 * still instead of rendering the free state and then swapping.
 */
export function usePlan(): { plan: Plan | null; isPremium: boolean } {
  const [plan, setPlan] = useState<Plan | null>(null);
  // A ref, not the state value: the failure path below only needs to know
  // whether an answer has ever landed, and reading `plan` there would put it
  // in the effect's dependency list and re-subscribe on every change.
  const resolved = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const onChange = (p: Plan) => {
      if (cancelled) return;
      resolved.current = true;
      setPlan(p);
    };
    planListeners.add(onChange);

    getPlan()
      .then(onChange)
      // getPlan resolves rather than rejects on a Firestore failure, so this
      // only fires if Firebase itself fails to load. Even then, don't assert
      // "free" over an entitlement we've already shown: hold the last known
      // answer and let the next navigation try again.
      .catch(() => {
        if (!cancelled && !resolved.current) setPlan("free");
      });

    return () => {
      cancelled = true;
      planListeners.delete(onChange);
    };
  }, []);

  return { plan, isPremium: plan === "premium" };
}

/**
 * Full subscription record for the billing screens (trial end, renewal date,
 * cancel state). Reads the same doc as getPlan but returns everything, not
 * just the entitlement bit. `null` while loading; a synthetic free record
 * when there's no subscription.
 */
export async function getPlanRecord(): Promise<PlanRecord> {
  const forced = forcedPlan();
  if (forced) return { plan: forced, status: forced === "premium" ? "active" : "none" };

  const uid = await currentUid();
  if (uid === "local") return { plan: "free", status: "none" };

  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(getDb(), "users", uid, "profile", "plan"));
    if (!snap.exists()) return { plan: "free", status: "none" };
    const data = snap.data() as PlanRecord;
    return { ...data, plan: data.plan === "premium" ? "premium" : "free" };
  } catch {
    // Same reasoning as getPlan: an unreachable Firestore is not a
    // cancellation. Fall back to the last entitlement we actually read, so
    // /account doesn't tell a subscriber they're on the free plan.
    return { plan: readCacheEntry(uid)?.plan ?? "free", status: "none" };
  }
}

export function usePlanRecord(): { record: PlanRecord | null; reload: () => void } {
  const [record, setRecord] = useState<PlanRecord | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPlanRecord()
      .then((r) => !cancelled && setRecord(r))
      .catch(() => !cancelled && setRecord({ plan: "free", status: "none" }));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { record, reload: () => setNonce((n) => n + 1) };
}
