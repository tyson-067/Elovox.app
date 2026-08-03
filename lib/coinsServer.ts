import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { ownedItems, seedCoins, shopItem, type ShopKind } from "./coins";
import type { ServerProgress } from "./leaderboardServer";

// Spending. The other half of lib/coins.ts, and the only code in the app that
// takes coins away.
//
// Both operations run as transactions on users/{uid}/score/progress, the same
// doc awardXp writes. That is what makes double-spending impossible: two tabs
// buying the same 500-coin biome with 500 coins read the same balance, and
// Firestore retries the loser against the balance the winner left behind.
// A read-then-write pair outside a transaction would let both through.
//
// Nothing here trusts a price, an item id, or a balance from the request. The
// route hands over a string; everything else is looked up server-side.

export type PurchaseOutcome =
  | { ok: true; coins: number; purchased: string[]; equipped: string }
  | {
      ok: false;
      reason: "unknown-item" | "already-owned" | "not-enough-coins";
      coins: number;
      /** Present on "not-enough-coins", so the UI can say how far off they are. */
      price?: number;
    };

/**
 * The balance to spend from.
 *
 * An account that has not recorded anything since the shop shipped has no
 * `coins` field at all — awardXp is what grants the starting balance, and it
 * only runs on a scored rep. Doing the same seed here means someone can open
 * the shop and spend what their level already earned without having to record
 * one more thing first. Both paths set coinsSeeded, so whichever runs first
 * wins and the other reads a real number.
 */
function balanceOf(prev: Partial<ServerProgress>): number {
  return prev.coinsSeeded ? Number(prev.coins ?? 0) : seedCoins(Number(prev.xp ?? 0));
}

/** Buy one shop item and put it on. */
export async function purchase(
  db: Firestore,
  uid: string,
  itemId: string
): Promise<PurchaseOutcome> {
  const item = shopItem(itemId);
  if (!item || item.price <= 0) {
    // Zero-price items are the ones everybody already has (the default
    // biome). Selling one would take coins for nothing.
    return { ok: false, reason: "unknown-item", coins: 0 };
  }

  const ref = db.doc(`users/${uid}/score/progress`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = (snap.data() ?? {}) as Partial<ServerProgress>;

    const owned = ownedItems(prev.purchased);
    const coins = balanceOf(prev);

    if (owned.includes(item.id)) {
      return { ok: false as const, reason: "already-owned" as const, coins };
    }
    if (coins < item.price) {
      return {
        ok: false as const,
        reason: "not-enough-coins" as const,
        coins,
        price: item.price,
      };
    }

    const purchased = [...(prev.purchased ?? []), item.id];
    const remaining = coins - item.price;

    // Wearing it immediately is the payoff. Buying a cape and then having to
    // find a second control to put it on is a shop that feels like paperwork.
    const equipKey =
      item.kind === "accessory"
        ? "equippedAccessory"
        : item.kind === "biome"
          ? "equippedBiome"
          : "equippedBackdrop";

    tx.set(
      ref,
      {
        coins: remaining,
        coinsSeeded: true,
        purchased,
        [equipKey]: item.id,
        updatedAt: FieldValue.serverTimestamp(),
      },
      // merge, unlike the award path: this transaction only knows about the
      // four fields it touches, and a full overwrite here would drop the XP
      // and streak the doc is mainly there to hold.
      { merge: true }
    );

    return {
      ok: true as const,
      coins: remaining,
      purchased,
      equipped: item.id,
    };
  });
}

export type EquipOutcome =
  | {
      ok: true;
      equippedAccessory: string | null;
      equippedBiome: string | null;
      equippedBackdrop: string | null;
    }
  | { ok: false; reason: "unknown-item" | "not-owned" };

/**
 * Wear something already owned, or take it off with `null`.
 *
 * Ownership is re-checked here rather than assumed from the purchase call:
 * this is a separate request, and "equip an item I never bought" is exactly
 * what someone would try.
 */
export async function equip(
  db: Firestore,
  uid: string,
  itemId: string | null,
  kind: ShopKind
): Promise<EquipOutcome> {
  const ref = db.doc(`users/${uid}/score/progress`);
  const key =
    kind === "accessory"
      ? "equippedAccessory"
      : kind === "biome"
        ? "equippedBiome"
        : "equippedBackdrop";

  if (itemId !== null) {
    const item = shopItem(itemId);
    if (!item || item.kind !== kind) {
      return { ok: false, reason: "unknown-item" };
    }
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = (snap.data() ?? {}) as Partial<ServerProgress>;

    // Never CREATE score/progress from here. Its non-existence is the signal
    // three other places rely on, and a merge:true write brings the doc into
    // being for a user who has never scored:
    //   - leaderboardServer seeds `backfillXp` only when the doc is absent, so
    //     an account that predates the leaderboard would be stranded at 0 XP
    //     with its whole rebuilt history lost, and nothing retries;
    //   - the referral bonus is paid on that same first-write, so both sides
    //     silently lose 100 XP;
    //   - redeemInvite rejects "invite links are for new accounts" once the
    //     doc exists, burning a stashed code.
    // This is reachable without owning anything: `null` ("take it off") skips
    // the ownership check entirely, and the free "den" biome passes it.
    if (!snap.exists) {
      return { ok: false as const, reason: "not-owned" as const };
    }

    if (itemId !== null && !ownedItems(prev.purchased).includes(itemId)) {
      return { ok: false as const, reason: "not-owned" as const };
    }

    tx.set(
      ref,
      { [key]: itemId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return {
      ok: true as const,
      equippedAccessory:
        kind === "accessory" ? itemId : (prev.equippedAccessory ?? null),
      equippedBiome: kind === "biome" ? itemId : (prev.equippedBiome ?? null),
      equippedBackdrop:
        kind === "backdrop" ? itemId : (prev.equippedBackdrop ?? null),
    };
  });
}
