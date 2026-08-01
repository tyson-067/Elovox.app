"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { InfoTip } from "@/components/InfoTip";
import { FelixScene, Biome } from "@/components/Biome";
import { Felix, type FelixAccessory } from "@/components/FoxLogo";
import {
  BIOMES,
  COINS_DAILY,
  COINS_PER_LEVEL,
  SHOP_ACCESSORIES,
  type ShopItem,
} from "@/lib/coins";
import {
  buyItem,
  equipItem,
  fetchShopState,
  type ShopState,
} from "@/lib/shop";

// Felix's shop. Spend coins on what he wears and where he stands.
//
// Nothing here decides anything. Every button posts to /api/shop and then
// re-reads the state the server wrote — the balance shown is never adjusted
// locally on success, because a client that does its own arithmetic on a
// balance will eventually disagree with the server about what someone owns.
// One round trip is cheap; a wrong coin count is not.

function Coins({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-data font-semibold">
      <span aria-hidden="true">🪙</span>
      <span>{n.toLocaleString()}</span>
    </span>
  );
}

function ItemCard({
  item,
  state,
  busy,
  onBuy,
  onEquip,
}: {
  item: ShopItem;
  state: ShopState;
  busy: boolean;
  onBuy: () => void;
  onEquip: () => void;
}) {
  const owned = state.owned.includes(item.id);
  const worn =
    item.kind === "biome"
      ? state.equippedBiome === item.id
      : state.equippedAccessory === item.id;
  const afford = state.coins >= item.price;

  return (
    <li className="card flex flex-col overflow-hidden p-0">
      <div className="relative aspect-square w-full bg-shrimp/30">
        {item.kind === "biome" ? (
          <Biome id={item.id} className="h-full w-full" />
        ) : (
          <Felix
            className="h-full w-full"
            accessory={item.id as FelixAccessory}
          />
        )}
        {/* Locked items are dimmed rather than hidden: seeing the cape you
            haven't bought is the entire reason to come back for it. */}
        {!owned && (
          <div className="absolute inset-0 bg-white/45 backdrop-grayscale" />
        )}
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="font-headline text-[15px] font-semibold text-primary">
          {item.name}
        </h3>
        <p className="mt-0.5 flex-1 text-[13px] leading-5 text-on-surface-variant">
          {item.detail}
        </p>

        <div className="mt-3">
          {worn ? (
            <span className="block rounded-lg bg-shrimp/60 py-2 text-center text-[13px] font-semibold text-primary">
              Wearing this
            </span>
          ) : owned ? (
            <button
              type="button"
              onClick={onEquip}
              disabled={busy}
              className="btn w-full rounded-lg bg-primary py-2 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {item.kind === "biome" ? "Move here" : "Wear it"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onBuy}
              disabled={busy || !afford}
              // When it isn't affordable the button's only content is the
              // price, and the coin emoji inside <Coins> is aria-hidden — so
              // its entire accessible name was the number "120".
              aria-label={`Buy ${item.name} for ${item.price} coins`}
              className={`btn w-full rounded-lg py-2 text-[13px] font-semibold disabled:opacity-60 ${
                afford
                  ? "bg-accent-strong text-white"
                  : "bg-shrimp/50 text-on-surface-variant"
              }`}
            >
              {afford ? (
                <>
                  Buy · <Coins n={item.price} />
                </>
              ) : (
                <Coins n={item.price} />
              )}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function ShopScreen() {
  // Three-state, like report/[id]: undefined = loading, null = load failed.
  const [state, setState] = useState<ShopState | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState(await fetchShopState());
  }, []);

  // Same shape as the other app screens: fetch, then set behind a cancelled
  // flag so a navigation mid-request doesn't set state on a gone component.
  useEffect(() => {
    let cancelled = false;
    fetchShopState()
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const act = useCallback(
    async (id: string, run: () => Promise<{ error?: string }>) => {
      setBusy(id);
      setError(null);
      try {
        const result = await run();
        if (result.error) setError(result.error);
        // Re-read either way. A failed buy still tells us the real balance,
        // which is usually why it failed. A re-read that itself fails must not
        // wedge every button disabled forever, hence the catch + finally.
        await load().catch(() =>
          setError("Couldn't refresh. Reload to see the latest.")
        );
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  if (state === undefined) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <p className="text-on-surface-variant">Opening the shop…</p>
      </div>
    );
  }

  if (state === null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <p className="text-on-surface-variant">
          The shop wouldn&apos;t load just now.
        </p>
        <button
          type="button"
          onClick={() => {
            setState(undefined);
            fetchShopState()
              .then(setState)
              .catch(() => setState(null));
          }}
          className="btn mt-4 rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:py-12">
      <Reveal>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-headline text-3xl font-semibold text-primary md:text-4xl">
              Felix&apos;s shop
            </h1>
            <p className="mt-1.5 max-w-lg text-on-surface-variant">
              Dress him up and move him somewhere new.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-shrimp/50 px-4 py-2.5">
            <span className="text-xl text-primary">
              <Coins n={state.coins} />
            </span>
            <InfoTip label="How do I get coins?">
              You earn coins for levelling up ({COINS_PER_LEVEL} a level), for
              each Daily Minute ({COINS_DAILY}), for hitting streak milestones,
              and for going back to something you haven&apos;t practiced in a
              while.
            </InfoTip>
          </div>
        </div>
      </Reveal>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-shrimp/60 px-4 py-3 text-[14px] text-primary"
        >
          {error}
        </p>
      )}

      <Reveal className="mt-8">
        <div className="card-warm flex flex-col items-center gap-5 p-5 sm:flex-row md:p-6">
          <FelixScene
            biome={state.equippedBiome}
            accessory={state.equippedAccessory as FelixAccessory | null}
            mood="cheer"
            className="h-40 w-40 shrink-0 rounded-xl"
          />
          <div className="text-center sm:text-left">
            <h2 className="font-headline text-xl font-semibold text-primary">
              This is Felix right now
            </h2>
            <p className="mt-1 text-[14px] leading-6 text-on-surface-variant">
              He shows up like this on your dashboard.
            </p>
            {state.equippedAccessory && (
              <button
                type="button"
                onClick={() =>
                  void act("bare", () => equipItem(null, "accessory"))
                }
                disabled={busy !== null}
                className="mt-3 text-[13px] font-semibold text-accent-strong disabled:opacity-60"
              >
                Take it off
              </button>
            )}
          </div>
        </div>
      </Reveal>

      <Reveal className="mt-10">
        <h2 className="font-headline text-xl font-semibold text-primary">
          What he wears
        </h2>
        {/* Says plainly why the level outfits aren't in this grid. Someone at
            Level 10 with a laurel wreath will otherwise wonder where it went. */}
        <p className="mt-1 text-[14px] text-on-surface-variant">
          Bought with coins. The outfits you unlocked by levelling are still
          yours — take everything off and Felix goes back to those.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {SHOP_ACCESSORIES.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              state={state}
              busy={busy !== null}
              onBuy={() => void act(item.id, () => buyItem(item.id))}
              onEquip={() =>
                void act(item.id, () => equipItem(item.id, "accessory"))
              }
            />
          ))}
        </ul>
      </Reveal>

      <Reveal className="mt-10">
        <h2 className="font-headline text-xl font-semibold text-primary">
          Where he stands
        </h2>
        <p className="mt-1 text-[14px] text-on-surface-variant">
          The den is home. The rest you buy.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {BIOMES.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              state={state}
              busy={busy !== null}
              onBuy={() => void act(item.id, () => buyItem(item.id))}
              onEquip={() =>
                void act(item.id, () => equipItem(item.id, "biome"))
              }
            />
          ))}
        </ul>
      </Reveal>

      <Reveal className="mt-10">
        <p className="text-[14px] text-on-surface-variant">
          Coins come from practice.{" "}
          <Link href="/dashboard" className="font-semibold text-accent-strong">
            Go earn some →
          </Link>
        </p>
      </Reveal>
    </div>
  );
}

export default function ShopPage() {
  return (
    <RequireAuth>
      <ShopScreen />
    </RequireAuth>
  );
}
