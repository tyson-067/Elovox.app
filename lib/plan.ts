"use client";

import { useEffect, useState } from "react";
import { isFirebaseConfigured, getDb, getUser } from "./firebase";

// Entitlements. One flag — free or premium — read from Firestore at
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
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

const cacheKey = (uid: string) => `elovox.plan.${uid}`;

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

export async function getPlan(): Promise<Plan> {
  const forced = forcedPlan();
  if (forced) return forced;

  const uid = await currentUid();

  try {
    const cached = window.localStorage.getItem(cacheKey(uid));
    if (cached === "premium" || cached === "free") return cached;
  } catch {
    // storage blocked — fall through to Firestore
  }
  if (uid === "local") return "free";

  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(getDb(), "users", uid, "profile", "plan"));
    const plan: Plan = snap.exists() && snap.data().plan === "premium" ? "premium" : "free";
    try {
      window.localStorage.setItem(cacheKey(uid), plan);
    } catch {
      // non-fatal
    }
    return plan;
  } catch {
    // Firestore unreachable — assume free rather than handing out Premium
    return "free";
  }
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
  return getPlan();
}

/**
 * Plan for the signed-in user. `null` while loading, so gated UI can hold
 * still instead of rendering the free state and then swapping.
 */
export function usePlan(): { plan: Plan | null; isPremium: boolean } {
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPlan()
      .then((p) => !cancelled && setPlan(p))
      .catch(() => !cancelled && setPlan("free"));
    return () => {
      cancelled = true;
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
    return { plan: "free", status: "none" };
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
