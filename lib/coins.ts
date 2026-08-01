import type { FelixAccessory } from "@/components/FoxLogo";
import { levelFromXp } from "./levels";

// Fox coins: the second currency, and the rules for earning and spending it.
//
// This file is pure and isomorphic on purpose — no firebase-admin, no
// firebase, no clock. It holds the catalog and the arithmetic so the shop UI
// and the server award path quote the same prices off the same source, and
// so every number here can be reasoned about without a database.
//
// WHERE COINS ACTUALLY LIVE, and why it matters: the balance is a field on
// users/{uid}/score/progress, the Admin-SDK-only doc that already holds
// ranked XP. It is NOT in users/{uid}/profile/stats. firestore.rules lets the
// owner write every profile doc except `plan`, so anything in there is a UI
// mirror the user can set from the browser console — fine for a progress bar,
// fatal for a balance you can spend. See the header of lib/leaderboardServer.ts.
//
// The consequence for anyone extending this: importing these functions on the
// client is fine and expected (the shop needs prices). Trusting a coin total
// that arrived from the client is not. Every award happens inside the awardXp
// transaction; every spend happens in lib/coinsServer.ts.

// --- Earning -------------------------------------------------------------

/** Coins for each level crossed. Levels are the steadiest earner. */
export const COINS_PER_LEVEL = 25;

/** Coins for showing up to the Daily Minute, paid on the first attempt only. */
export const COINS_DAILY = 5;

/**
 * Streak payouts, at the days people actually feel. Not a per-day trickle:
 * a coin a day is noise, whereas "you hit fourteen and something happened"
 * is the thing that gets someone back tomorrow.
 *
 * Past the last milestone the run keeps paying weekly, so a 200-day streak
 * isn't silently worth less per day than a 30-day one.
 */
const STREAK_MILESTONES: Record<number, number> = {
  3: 10,
  7: 25,
  14: 40,
  21: 60,
  30: 100,
};

const STREAK_WEEKLY_AFTER = 30;
const STREAK_WEEKLY_COINS = 25;

export function coinsForStreakDay(streakDays: number): number {
  if (!Number.isFinite(streakDays) || streakDays <= 0) return 0;
  const milestone = STREAK_MILESTONES[streakDays];
  if (milestone) return milestone;
  if (streakDays > STREAK_WEEKLY_AFTER && streakDays % 7 === 0) {
    return STREAK_WEEKLY_COINS;
  }
  return 0;
}

/**
 * How long an activity has to sit untouched before going back to it pays.
 *
 * Two weeks, not two days. The point is to pull someone back to the speech
 * library after a month of nothing but the Daily Minute — not to pay them for
 * rotating through four tabs every afternoon, which is what a short window
 * turns this into.
 */
export const COMEBACK_DAYS = 14;

export const COINS_COMEBACK = 15;

/** Coins for crossing from `prevXp` to `nextXp`. Zero when no level changed. */
export function coinsForLevelUps(prevXp: number, nextXp: number): number {
  const gained = levelFromXp(nextXp).level - levelFromXp(prevXp).level;
  return gained > 0 ? gained * COINS_PER_LEVEL : 0;
}

/**
 * The balance an existing account starts with, so the shop isn't empty on the
 * day it ships for someone who has been practicing for months.
 *
 * Derived from server XP — the backfilled, deliberately-under-counted total in
 * score/progress — and never from stats.xp, which is forgeable. It pays for
 * the levels already reached and nothing else: no retroactive streaks, no
 * retroactive dailies, because there is no trustworthy per-day record of
 * which of those were hit. Under-crediting is the only safe direction.
 */
export function seedCoins(xp: number): number {
  return Math.max(0, levelFromXp(xp).level - 1) * COINS_PER_LEVEL;
}

// --- The shop ------------------------------------------------------------

export type ShopKind = "accessory" | "biome";

/**
 * The biomes, as a closed set. This is the single source of the ids: the
 * scenes in components/Biome.tsx are keyed by this type, so adding an entry
 * here without drawing it is a compile error rather than a blank square.
 */
export const BIOME_IDS = ["den", "meadow", "pines", "rooftop", "dunes"] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

export function isBiomeId(id: string | null | undefined): id is BiomeId {
  return !!id && (BIOME_IDS as readonly string[]).includes(id);
}

export interface ShopItem {
  id: string;
  kind: ShopKind;
  name: string;
  /** One short line. Shown under the name in the shop. */
  detail: string;
  price: number;
}

/**
 * Felix's biomes: where he stands. `den` is the view every account has always
 * had, so it is owned from the start and priced at zero rather than being
 * sold back to people who already have it.
 *
 * Prices climb with how different the scene is from the default. At the rates
 * above a daily user earns roughly 40-60 coins a week, so the cheap end is a
 * few days away and the expensive end is a month — long enough to be worth
 * something, short enough that nobody gives up.
 */
export const BIOMES: (ShopItem & { id: BiomeId })[] = [
  {
    id: "den",
    kind: "biome",
    name: "The den",
    detail: "Where Felix started. Yours already.",
    price: 0,
  },
  {
    id: "meadow",
    kind: "biome",
    name: "Summer meadow",
    detail: "Long grass, low sun.",
    price: 150,
  },
  {
    id: "pines",
    kind: "biome",
    name: "Snow pines",
    detail: "Cold air, quiet trees.",
    price: 250,
  },
  {
    id: "rooftop",
    kind: "biome",
    name: "City rooftop",
    detail: "Night, and the lights below.",
    price: 350,
  },
  {
    id: "dunes",
    kind: "biome",
    name: "Desert dusk",
    detail: "Red sand, last light.",
    price: 500,
  },
];

/**
 * Accessories you buy, as opposed to the level-gated wardrobe in lib/quests.ts.
 *
 * The two are kept separate deliberately. The wardrobe items were earned by
 * levelling and several accounts already wear them; putting a price on
 * something a user already owns would read as taking it away. So levels keep
 * their six, and coins buy things levels never gave.
 */
export const SHOP_ACCESSORIES: (ShopItem & { id: FelixAccessory })[] = [
  {
    id: "sunglasses",
    kind: "accessory",
    name: "Shades",
    detail: "For the takes that went well.",
    price: 80,
  },
  {
    id: "beanie",
    kind: "accessory",
    name: "Beanie",
    detail: "Off-duty fox.",
    price: 120,
  },
  {
    id: "cape",
    kind: "accessory",
    name: "Cape",
    detail: "Unsubtle. That's the point.",
    price: 200,
  },
];

export const SHOP_ITEMS: ShopItem[] = [...SHOP_ACCESSORIES, ...BIOMES];

/** The biome a user with nothing bought is standing in. */
export const DEFAULT_BIOME = "den";

export function shopItem(id: string): ShopItem | null {
  return SHOP_ITEMS.find((i) => i.id === id) ?? null;
}

/**
 * True when the user has this item without having bought it. Right now that is
 * only the default biome, but the check exists so "owned" is asked as a
 * question rather than assumed from the purchase list — the purchase route
 * uses it to reject paying for something that was always free.
 */
export function isFreeItem(id: string): boolean {
  const item = shopItem(id);
  return !!item && item.price === 0;
}

/** Everything a user owns: what they bought, plus what everyone gets. */
export function ownedItems(purchased: string[] | undefined): string[] {
  const free = SHOP_ITEMS.filter((i) => i.price === 0).map((i) => i.id);
  return [...new Set([...free, ...(purchased ?? [])])];
}
