"use client";

import { useEffect, useState } from "react";
import { tapMedium, notifySuccess } from "@/lib/haptics";
import { useIsNative } from "@/lib/native";
import { FelixScene, Biome } from "@/components/Biome";
import { Felix, type FelixAccessory } from "@/components/FoxLogo";
import { CoinGlyph } from "@/components/native/felix";
import { NvSectionHeader } from "@/components/native/ui";
import {
  BIOMES,
  COINS_DAILY,
  COINS_PER_LEVEL,
  SHOP_ACCESSORIES,
  type BiomeId,
  type ShopItem,
} from "@/lib/coins";
import type { ShopState } from "@/lib/shop";

/**
 * FELIX'S SHOP, in the app.
 *
 * The web shop is a max-w-5xl page of `card` grids under an h1 — which, pushed
 * inside the native shell, put "Felix's shop" in the title bar and "Felix's
 * shop" again forty pixels below it, in a different family, at a different
 * size. That double title is the exact tell NativeShell's docs open by warning
 * about, and it was on the screen the coin badge and the reward node BOTH lead
 * to: the two most-tapped doors in the app opened onto the website.
 *
 * Nothing about the economy moves here. Every button still calls the page's
 * `act()`, which posts to /api/shop and re-reads what the server wrote — this
 * file owns presentation and the confirm step, and no arithmetic at all.
 *
 * Renders nothing in a browser; the web markup it replaces carries
 * `native-hide`.
 */

/** Above this, a purchase asks twice. Mirrors CONFIRM_ABOVE_COINS on the web —
 *  same rule, because it's a rule about money and not about layout. */
const CONFIRM_ABOVE_COINS = 150;

function Price({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <CoinGlyph className="h-[14px] w-[14px]" />
      <span className="nv-num" aria-hidden="true">
        {n.toLocaleString()}
      </span>
    </span>
  );
}

function TickGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 12.5 5.5 5.5L20 6.5" />
    </svg>
  );
}

/* --- One item -------------------------------------------------------------
   Art on top, name and one line under it, and exactly one control. The art is
   a real preview — Felix actually wearing the thing, the biome actually drawn
   — because the whole reason to come back for the cape is having seen it. */
function ShopTile({
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
  const [armed, setArmed] = useState(false);
  // An armed button that stays armed is worse than no confirmation: you arm
  // one, get distracted, come back and tap what looks like Buy. Same six
  // seconds the web card uses.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);

  const owned = state.owned.includes(item.id);
  const worn =
    item.kind === "biome"
      ? state.equippedBiome === item.id
      : state.equippedAccessory === item.id;
  const afford = state.coins >= item.price;
  const needsConfirm = item.price > CONFIRM_ABOVE_COINS;

  return (
    <div className="nv-shop-item">
      <div className="nv-shop-art" data-locked={owned ? undefined : ""}>
        {item.kind === "biome" ? (
          <Biome id={item.id as BiomeId} className="h-full w-full" />
        ) : (
          <Felix
            className="h-full w-full"
            accessory={item.id as FelixAccessory}
          />
        )}
      </div>

      <div className="nv-shop-body">
        <span className="nv-shop-name">{item.name}</span>
        <span className="nv-shop-detail">{item.detail}</span>

        {worn ? (
          <span className="nv-shop-worn">
            <TickGlyph />
            {item.kind === "biome" ? "Here now" : "Wearing this"}
          </span>
        ) : owned ? (
          <button
            type="button"
            onClick={onEquip}
            disabled={busy}
            className="nv-shop-btn"
            data-tone="own"
          >
            {item.kind === "biome" ? "Move here" : "Wear it"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (needsConfirm && !armed) {
                  // Arming is a warning, so it gets a heavier tick than the
                  // blanket one every control gets. The hand should notice
                  // that this tap did something different from the last one.
                  tapMedium();
                  setArmed(true);
                  return;
                }
                setArmed(false);
                notifySuccess();
                onBuy();
              }}
              disabled={busy || !afford}
              // Unaffordable, the button's only content is a number and a
              // glyph that's aria-hidden — so its whole accessible name was
              // "200". Say what the control does either way.
              aria-label={
                !afford
                  ? `${item.name} costs ${item.price} coins, and you have ${state.coins}`
                  : armed
                    ? `Confirm: spend ${item.price} coins on ${item.name}`
                    : `Buy ${item.name} for ${item.price} coins`
              }
              className="nv-shop-btn"
              data-tone={!afford ? "short" : armed ? "armed" : "buy"}
            >
              {!afford ? (
                <Price n={item.price} />
              ) : armed ? (
                <>Spend it?</>
              ) : (
                <Price n={item.price} />
              )}
            </button>
            {armed && (
              <button
                type="button"
                onClick={() => setArmed(false)}
                className="nv-shop-cancel"
              >
                Never mind
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function NativeShop({
  state,
  busy,
  error,
  onBuy,
  onEquip,
  onUnequip,
}: {
  state: ShopState;
  /** The id currently in flight, or null. Every button locks while one is. */
  busy: string | null;
  error: string | null;
  onBuy: (item: ShopItem) => void;
  onEquip: (item: ShopItem) => void;
  onUnequip: () => void;
}) {
  const native = useIsNative();
  if (!native) return null;

  const anyBusy = busy !== null;

  // The page's own vertical rhythm lives on a container this screen sits
  // OUTSIDE of (that container is native-hidden whole, so its px-4 can't
  // double up on the shell's gutter). So the padding is here, where it only
  // exists when this component does.
  return (
    <div className="pt-4 pb-2">
      {/* --- Felix as he stands ---------------------------------------------
          The shop's subject, at the top, at size. Everything below is a change
          to THIS picture, which is easier to feel than to read. */}
      <div className="nv-shop-stage">
        <FelixScene
          biome={state.equippedBiome}
          accessory={state.equippedAccessory as FelixAccessory | null}
          mood="cheer"
          className="nv-shop-stage-art"
        />
        <div className="nv-shop-stage-row">
          <span className="nv-footnote font-semibold">Felix right now</span>
          <span className="nv-badge" data-pop="sun">
            <CoinGlyph className="h-[16px] w-[16px]" />
            <span className="nv-num" aria-hidden="true">
              {state.coins.toLocaleString()}
            </span>
            <span className="sr-only">{state.coins.toLocaleString()} coins</span>
          </span>
        </div>
        {state.equippedAccessory && (
          <button
            type="button"
            onClick={onUnequip}
            disabled={anyBusy}
            className="nv-btn nv-btn-plain mt-1 disabled:opacity-50"
          >
            Take it off
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="nv-shop-error">
          {error}
        </p>
      )}

      <NvSectionHeader>What he wears</NvSectionHeader>
      {/* Says plainly why the level outfits aren't in this grid — someone at
          Level 10 in a laurel wreath will otherwise wonder where it went. */}
      <p className="nv-footnote -mt-2 mb-3 px-1">
        Bought with coins. The outfits you unlocked by levelling are still
        yours. Take everything off and Felix goes back to those.
      </p>
      <div className="nv-shop-grid">
        {SHOP_ACCESSORIES.map((item) => (
          <ShopTile
            key={item.id}
            item={item}
            state={state}
            busy={anyBusy}
            onBuy={() => onBuy(item)}
            onEquip={() => onEquip(item)}
          />
        ))}
      </div>

      <NvSectionHeader>Where he stands</NvSectionHeader>
      <p className="nv-footnote -mt-2 mb-3 px-1">
        The den is home. The rest you buy.
      </p>
      <div className="nv-shop-grid">
        {BIOMES.map((item) => (
          <ShopTile
            key={item.id}
            item={item}
            state={state}
            busy={anyBusy}
            onBuy={() => onBuy(item)}
            onEquip={() => onEquip(item)}
          />
        ))}
      </div>

      {/* Where coins come from. A footnote rather than the web's InfoTip
          popover: on a phone the answer is three lines, and three lines are
          cheaper to read than a disclosure to tap. */}
      <p className="nv-footnote mt-8 px-1 leading-5">
        Coins come from practice: {COINS_PER_LEVEL} a level,{" "}
        {COINS_DAILY} for each Daily Minute, more at every streak milestone, and
        a bonus for going back to something you haven&apos;t practiced in a
        while.
      </p>
    </div>
  );
}
