"use client";

import { isFirebaseConfigured, getDb, getUser } from "./firebase";
import { DEFAULT_BIOME, ownedItems, seedCoins, type ShopKind } from "./coins";

// Browser half of the shop. Reads straight from Firestore, writes through
// /api/shop and nowhere else.
//
// The asymmetry is the whole design. users/{uid}/score/progress is
// owner-READABLE in firestore.rules, so showing a balance needs no round trip
// — but it is deny-all for writes, so changing one does. That means this file
// can render the shop with no server involvement and still has no way to give
// anyone a single coin, which is exactly the split we want. Same shape as
// lib/leaderboard.ts.

export interface ShopState {
  coins: number;
  /** Everything owned, including the free default biome. */
  owned: string[];
  equippedAccessory: string | null;
  equippedBiome: string;
  /** Site backdrop (web only). Null means plain — there is no default item. */
  equippedBackdrop: string | null;
}

const EMPTY: ShopState = {
  coins: 0,
  owned: ownedItems([]),
  equippedAccessory: null,
  equippedBiome: DEFAULT_BIOME,
  equippedBackdrop: null,
};

/**
 * The shop state, or EMPTY. NEVER REJECTS — and callers depend on that.
 *
 * Both call sites (the web header chip in AuthNav, the native Account avatar)
 * hold a `ShopState | null` and treat null as "still loading", so a rejection
 * here is indistinguishable from a fetch that never finished: the skeleton
 * stays up for the life of the screen. That is exactly what a cold launch
 * against production produced — this read races App Check's first token and
 * Firestore rejects it, once, permanently stranding the avatar.
 *
 * A failed read is not an error worth showing anybody: it means "we could not
 * tell what gear you own", and the honest render of that is Felix at home in
 * the default biome — which is already what a signed-out user sees.
 */
export async function fetchShopState(): Promise<ShopState> {
  try {
    return await readShopState();
  } catch {
    return EMPTY;
  }
}

async function readShopState(): Promise<ShopState> {
  if (!isFirebaseConfigured()) return EMPTY;
  const user = await getUser();
  if (!user) return EMPTY;

  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(getDb(), "users", user.uid, "score", "progress"));
  if (!snap.exists()) return EMPTY;
  const data = snap.data() as {
    coins?: number;
    coinsSeeded?: boolean;
    xp?: number;
    purchased?: string[];
    equippedAccessory?: string | null;
    equippedBiome?: string | null;
    equippedBackdrop?: string | null;
  };

  // The same seed the server applies on first write (see balanceOf in
  // lib/coinsServer.ts). An account that has not recorded anything since the
  // shop shipped has no `coins` field yet, and showing them zero when the
  // server would let them spend their level money reads as a bug.
  const coins = data.coinsSeeded
    ? Number(data.coins ?? 0)
    : seedCoins(Number(data.xp ?? 0));

  return {
    coins,
    owned: ownedItems(data.purchased),
    equippedAccessory: data.equippedAccessory ?? null,
    equippedBiome: data.equippedBiome ?? DEFAULT_BIOME,
    equippedBackdrop: data.equippedBackdrop ?? null,
  };
}

async function post(body: Record<string, unknown>): Promise<{ error?: string }> {
  const user = await getUser();
  if (!user) return { error: "Sign in first." };
  try {
    const res = await fetch("/api/shop", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error ?? "Couldn't do that." };
    return {};
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

export function buyItem(item: string) {
  return post({ action: "buy", item });
}

/** Wear something owned, or pass null to take it off. */
export function equipItem(item: string | null, kind: ShopKind) {
  return post({ action: "equip", item, kind });
}
