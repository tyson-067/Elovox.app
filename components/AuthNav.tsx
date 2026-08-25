"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { FelixScene } from "@/components/Biome";
import { type FelixAccessory } from "@/components/FoxLogo";
import { NavMenu } from "@/components/NavMenu";
import { usePlan } from "@/lib/plan";
import { fetchShopState, type ShopState } from "@/lib/shop";
import { signOutUser } from "@/lib/auth";

// Header navigation that adapts to auth state: app links + sign out when
// logged in, log in / get started when logged out. Without Firebase config
// (local dev) the app links show unconditionally.

export function AuthNav() {
  const { user, loading, configured } = useAuth();
  const { plan } = usePlan();
  const router = useRouter();

  // The avatar is Felix in the user's equipped gear, not a letter in a
  // circle: the fox they dress in the shop is the closest thing an account
  // here has to a face, so the account chip should wear it too. One read on
  // mount is enough — equipping happens on /shop, and the header remounts on
  // the way back.
  //
  // Deliberately NOT the quests machinery: the Ladder falls back from the
  // equipped accessory to the level outfit, but that needs stats this header
  // doesn't have and shouldn't fetch. Nothing equipped is just bare Felix,
  // which is a fine face.
  // Keyed by the uid it was fetched FOR, and only read back under that same
  // uid — so a sign-out needs no state reset in the effect (the compiler
  // lint is right that those cascade), and another account's gear can never
  // flash during the switchover.
  const [fetched, setFetched] = useState<{ uid: string; shop: ShopState } | null>(null);
  // Bumped by the shop page after any successful buy/equip ("elovox:shop") —
  // the layout persists across client navigations, so without this the chip
  // kept wearing the gear from sign-in time until a full reload.
  const [rev, setRev] = useState(0);
  const uid = user?.uid ?? null;
  useEffect(() => {
    const onShopChange = () => setRev((r) => r + 1);
    window.addEventListener("elovox:shop", onShopChange);
    return () => window.removeEventListener("elovox:shop", onShopChange);
  }, []);
  useEffect(() => {
    if (!uid) return;
    let stale = false;
    void fetchShopState().then((shop) => {
      if (!stale) setFetched({ uid, shop });
    });
    return () => {
      stale = true;
    };
  }, [uid, rev]);
  const shop = uid && fetched?.uid === uid ? fetched.shop : null;

  if (loading) return null;

  // The way back into the app from a marketing page. Once inside, SubNav
  // carries the per-feature tabs, so repeating them up here would only split
  // attention.
  //
  // Deliberately paired with Pricing below rather than shown on its own: see
  // the note in the signed-in branch.
  const practiceLink = (
    <Link href="/dashboard" className="nav-link hover:text-primary">
      Practice
    </Link>
  );

  // Pricing is a link for people deciding whether to pay. Once someone IS
  // paying it is noise in the one row of chrome they see on every screen,
  // and worse, it points at a page whose whole job is to sell them something
  // they already own. Subscribers manage billing from /account, which still
  // links through to /pricing as "Compare plans" for the rare case they want
  // to see the grid.
  const pricingLink = (
    <Link href="/pricing" className="nav-link hover:text-primary web-only">
      Pricing
    </Link>
  );

  // Signed-out visitors only, on every marketing page, at `sm` and up.
  //
  // /about exists to convince a stranger there are people behind the product.
  // Someone with an account has already made that call, so this lives in the
  // signed-out branches alone and never appears once they're in the app.
  //
  // Labelled "About", not "Meet the team": the page leads with why Elovox
  // exists and lists the team underneath, so the narrower label is the honest
  // one.
  //
  // A top-level item at every width that can hold one, on purpose. It spent
  // a while inside the Explore menu and the verdict was blunt: buried in a
  // product menu, company info reads as product copy and nobody thinks to
  // look for the people there. So it stands alone, last of the marketing
  // links, where every website keeps its About.
  //
  // Still hidden below `sm` because the space genuinely isn't there: the
  // 375px header has ~257px of room next to the wordmark, and Pricing +
  // Log in + Get started plus their gaps already spend ~240px of it. A
  // fourth item doesn't shrink, it wraps, landing on top of the wordmark
  // and breaking "Get started" onto two lines. Mobile reaches /about
  // through the footer instead, see FooterAboutLink, which is gated the
  // same way this is.
  const aboutLink = (
    <Link href="/about" className="nav-link hidden sm:block hover:text-primary">
      About
    </Link>
  );

  // Depth without more top-level items: at `md` and up the Explore menu
  // carries the three /for/* audience pages (which otherwise had one route
  // in, a card partway down the homepage) and the page's own sections.
  // About is deliberately NOT in it — see the note on aboutLink.
  const exploreMenu = <NavMenu />;

  if (!configured) {
    return (
      <>
        {exploreMenu}
        {pricingLink}
        {aboutLink}
        {practiceLink}
      </>
    );
  }

  if (!user) {
    return (
      <>
        {exploreMenu}
        {pricingLink}
        {aboutLink}
        <Link href="/login" className="nav-link hover:text-primary">
          Log in
        </Link>
        <Link
          href="/signup"
          className="btn rounded-full bg-primary text-on-primary px-4 py-1.5"
        >
          Start free
        </Link>
      </>
    );
  }

  // The account affordance: an avatar chip, not a bare name sitting inline
  // with the nav links (which reads like a stray tab). The avatar is Felix in
  // the user's gear; the initial — display name or email, so it's always
  // something sensible — only covers the beat before the shop state arrives.
  const label = user.displayName || user.email || "Account";
  const initial = label.trim().charAt(0).toUpperCase() || "A";
  // An unverified address is the one account state worth interrupting for:
  // until it's confirmed, RequireAuth holds the user out of the app entirely,
  // so the dot is the only clue as to why.
  const needsAttention = !user.emailVerified;

  return (
    <>
      {/* Both links, or neither.

          Pricing is only for people who could still buy something: once
          someone IS paying it's noise pointing at a page whose whole job is
          to sell them what they already own. Subscribers manage billing from
          /account, which links through to /pricing as "Compare plans".

          Practice then goes with it. On its own beside the account chip it
          was a single lonely tab that duplicated the sub-nav sitting
          directly beneath it, on every app page. It exists to get a free
          user back into the app from /pricing, so it lives and dies with
          that link. A subscriber's route back is the wordmark, which is
          where people reach for it anyway.

          Both are keyed off `plan === "free"` rather than `!== "premium"`:
          `plan` is null while it loads, so nothing appears and then vanishes
          a beat later. */}
      {plan === "free" && (
        <>
          {pricingLink}
          {practiceLink}
        </>
      )}
      {/* Shown at every width. It used to be hidden below the `sm` breakpoint,
          which on a mobile-first app meant most users had no route to their
          account, verification state, or billing at all. The name is what
          collapses on small screens now, not the whole control. */}
      <Link
        href="/account"
        title="Account settings"
        aria-label={
          needsAttention
            ? `Account: ${label}, email not verified`
            : `Account: ${label}`
        }
        className="relative flex items-center gap-2 rounded-full border border-primary/15 bg-surface-lowest/70 py-1 pl-1 pr-1 sm:pr-3 transition-colors hover:border-accent/50 hover:bg-surface-lowest"
      >
        {/* Felix once the shop state lands; the initial until then, so the
            slot never sits empty and never flashes a default-dressed fox
            that swaps outfits a beat later. */}
        {shop ? (
          <FelixScene
            biome={shop.equippedBiome}
            accessory={(shop.equippedAccessory as FelixAccessory | null) ?? undefined}
            className="h-6 w-6 rounded-full"
          />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-accent to-orange text-micro font-bold text-white">
            {initial}
          </span>
        )}
        <span className="hidden sm:block max-w-[14ch] truncate text-primary/80">
          {label}
        </span>
        {needsAttention && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber ring-2 ring-surface"
          />
        )}
      </Link>
      {/* Quieter than the account chip on purpose. With Pricing and Practice
          gone for subscribers these two are the whole right-hand side, and
          two equally-weighted controls read as a choice rather than as "your
          account, and the way out of it". */}
      <button
        onClick={async () => {
          await signOutUser();
          router.push("/");
        }}
        className="text-primary/75 transition-colors hover:text-primary"
      >
        Sign out
      </button>
    </>
  );
}
