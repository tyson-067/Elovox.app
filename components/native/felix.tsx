"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { FelixMark, type FelixMood } from "@/components/FoxLogo";

/**
 * The gamification kit: Felix's reward layer, app only.
 *
 * Everything here draws from the festival palette and the animation grammar
 * at the end of app/native-theme.css — soft springs for everyday entrances,
 * the bouncy spring for rewards, transform/opacity only, everything silenced
 * under Reduce Motion. Only Native* screens import from here, so none of it
 * can leak into the website.
 *
 * All of it is decoration over numbers that are already legible as text —
 * every component is either aria-hidden or carries its meaning as real text.
 */

/* --- The palette cycle ------------------------------------------------------
   Six pops, assigned by position so lists get a stable spectrum without any
   screen picking colors by hand. Semantic constants stay fixed elsewhere:
   ember = live/streak, sun = coins and XP, mint = high scores. */
export type NvPop = "ember" | "sky" | "mint" | "sun" | "lilac" | "rose" | "lime";
const CYCLE: NvPop[] = ["ember", "sky", "mint", "sun", "lilac", "rose"];

export function popFor(i: number): NvPop {
  return CYCLE[i % CYCLE.length];
}

/* --- Score bands ------------------------------------------------------------
   One mapping for every screen that colors a score, so the report dial and
   the Progress hero can never disagree about what 82 feels like. The moods
   deliberately never go below "coach": a rough take gets coaching, not a
   disappointed fox. */
export function bandForScore(score: number): "rough" | "low" | "mid" | "high" {
  if (score >= 85) return "high";
  if (score >= 70) return "mid";
  if (score >= 55) return "low";
  return "rough";
}

export function moodForScore(score: number): FelixMood {
  if (score >= 85) return "cheer";
  if (score >= 70) return "idle";
  return "coach";
}

/* --- Badge ------------------------------------------------------------------
   The game's chip: streak, coins, XP, "new best". Rendered text, real
   contrast, pops in with the bouncy spring via .nv-badge. */
export function NvBadge({
  pop,
  children,
  className = "",
}: {
  pop?: NvPop;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`nv-badge ${className}`.trim()} data-pop={pop}>
      {children}
    </span>
  );
}

/* --- Speech bubble ----------------------------------------------------------
   Felix's line in an actual bubble, tail pointing at whichever fox is
   speaking — left when he sits beside it, top when he stands over it. The
   wrapper stays a plain div so screen readers read it as the paragraph it
   is. */
export function FelixBubble({
  children,
  side = "left",
  className = "",
}: {
  children: ReactNode;
  side?: "left" | "top";
  className?: string;
}) {
  return (
    <div className={`nv-bubble ${className}`.trim()} data-side={side}>
      {children}
    </div>
  );
}

/* --- The streak flame -------------------------------------------------------
   Color climbs with the streak: ember → gold → hot pink → violet → the
   legendary blue at 30 days. The tier lives on the wrapper; the CSS keys
   the flame's two layers off it. */
function flameTier(days: number): number {
  if (days >= 30) return 5;
  if (days >= 14) return 4;
  if (days >= 7) return 3;
  if (days >= 3) return 2;
  return 1;
}

function FlameGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 26" className={`nv-flame ${className}`.trim()} aria-hidden="true">
      {/* The silhouette is stroked with --flame-edge (native-theme.css): a warm
          dark outline in light mode, none in dark. Without it the gold tier
          sat at 1.6:1 on its own pale badge ground and the flame simply was
          not there — the tiers climb through pale hues, so no single fill can
          carry the shape on both grounds. The outline does it instead, and
          every tier keeps its own color. */}
      <path
        d="M10 0 C13.5 6 18 9.5 18 16 A8 8 0 0 1 2 16 C2 9.5 6.5 6 10 0 Z"
        fill="var(--flame-a)"
        stroke="var(--flame-edge, transparent)"
        strokeWidth="1.1"
      />
      <path
        d="M10 8 C12 11 14.5 13.5 14.5 17.5 A4.5 4.5 0 0 1 5.5 17.5 C5.5 13.5 8 11 10 8 Z"
        fill="var(--flame-b)"
      />
      <ellipse cx="10" cy="18.5" rx="2.4" ry="3" fill="#fff8ee" opacity="0.9" />
    </svg>
  );
}

/** The streak as a HUD badge. */
export function StreakBadge({ days }: { days: number }) {
  return (
    <span className="nv-badge" data-pop="ember" data-tier={flameTier(days)}>
      <FlameGlyph className="h-[18px] w-[14px]" />
      <span className="nv-num">{days}</span> day streak
    </span>
  );
}

/** The streak at stat size, for Progress's stat strip. */
export function StreakStat({ days }: { days: number }) {
  return (
    <div
      className="flex min-w-0 flex-col items-center gap-0.5"
      data-tier={flameTier(days)}
    >
      <div className="flex items-center gap-1.5">
        {days > 0 && <FlameGlyph className="h-[20px] w-[15px]" />}
        <span className="nv-stat-value nv-num">{days}</span>
      </div>
      <span className="nv-stat-label">day streak</span>
    </div>
  );
}

/* --- The coin ---------------------------------------------------------------
   Felix's currency wears the voice bars, like everything he owns. The badge
   links to the shop — tapping your money shows you what it buys. */
/* The engraving is a FIXED dark brown in both modes, not --nv-pop-sun-ink.
   That token is the ink for text sitting ON the pale soft ground, and in dark
   mode it lightens to #ffd35c — which is the same value as the disc itself
   (1.08:1), so the coin lost its bars entirely and read as a blank counter.
   A real coin's relief is dark in any light; the disc is always gold, so the
   engraving can be a constant. */
const COIN_ENGRAVING = "#7a4e00";

function CoinGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`nv-coin ${className}`.trim()} aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="var(--nv-pop-sun)" />
      <circle
        cx="10"
        cy="10"
        r="7.2"
        fill="none"
        stroke={COIN_ENGRAVING}
        strokeWidth="1.2"
        opacity="0.55"
      />
      <g fill={COIN_ENGRAVING}>
        <rect x="6.1" y="8.2" width="1.7" height="3.6" rx="0.85" />
        <rect x="9.15" y="6.4" width="1.7" height="7.2" rx="0.85" />
        <rect x="12.2" y="8.2" width="1.7" height="3.6" rx="0.85" />
      </g>
    </svg>
  );
}

export function CoinBadge({ coins }: { coins: number }) {
  return (
    <Link
      href="/shop"
      className="nv-badge nv-press"
      data-pop="sun"
      aria-label={`${coins.toLocaleString()} coins — open Felix's shop`}
    >
      <CoinGlyph className="h-[16px] w-[16px]" />
      <span className="nv-num" aria-hidden="true">
        {coins.toLocaleString()}
      </span>
    </Link>
  );
}

/* --- The XP ring ------------------------------------------------------------
   Level progress drawn around the avatar, rings-style. The arc holds empty
   for one frame, then the real offset lands and the soft spring sweeps it
   round with a ~3% overshoot (same pattern as the report dial). Fixed
   gradient id, same shared-defs rule as FoxLogo. */
const RING_R = 29;
const RING_C = 2 * Math.PI * RING_R;

export function XpAvatar({
  percent,
  level,
  children,
}: {
  /** 0-100 through the current level. Absent while stats load. */
  percent?: number;
  /**
   * The level for the corner chip. OPTIONAL on purpose: stats arrive after
   * first paint, and the caller must keep rendering this same component
   * while they do. Swapping to a bare avatar and back put two different
   * component types in one slot — React tore the fox down and rebuilt it
   * (restarting his animations) and the box jumped 56 -> 64px on every cold
   * load of the home screen. Undefined means "not yet": empty ring, no chip,
   * same geometry.
   */
  level?: number;
  /** The avatar itself (FelixScene), filling the ring's well. */
  children: ReactNode;
}) {
  const [drawn, setDrawn] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (drawn) return;
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, [drawn]);

  const pct = Math.max(0, Math.min(100, percent ?? 0));
  const offset = RING_C * (1 - pct / 100);

  return (
    <span className="relative block h-16 w-16">
      <span className="absolute inset-[5px] overflow-hidden rounded-full">
        {children}
      </span>
      <svg
        viewBox="0 0 64 64"
        className="absolute inset-0 h-full w-full -rotate-90"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="nv-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--nv-accent-500)" />
            <stop offset="55%" stopColor="var(--nv-pop-rose)" />
            <stop offset="100%" stopColor="var(--nv-pop-lilac)" />
          </linearGradient>
        </defs>
        <circle
          className="nv-ring-track"
          cx="32"
          cy="32"
          r={RING_R}
          fill="none"
          strokeWidth="4"
        />
        <circle
          className="nv-ring-arc"
          cx="32"
          cy="32"
          r={RING_R}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          stroke="url(#nv-ring-grad)"
          strokeDasharray={RING_C}
          strokeDashoffset={drawn ? offset : RING_C}
        />
      </svg>
      {level !== undefined && (
        <span className="nv-lv-chip" aria-hidden="true">
          {level}
        </span>
      )}
    </span>
  );
}

/* --- Felix peeks over a card ------------------------------------------------
   Ears and eyes over the top edge; the card clips the rest. The parent card
   needs position:relative. He blinks up there on the shared 7.3s loop. */
export function FelixPeek({ mood = "idle" }: { mood?: FelixMood }) {
  return (
    <span className="nv-peek" aria-hidden="true">
      <FelixMark mood={mood} />
    </span>
  );
}

/* --- Sparkles ---------------------------------------------------------------
   Three tiny stars twinkling out of phase around an avatar. Decorative,
   absolute; the parent needs position:relative. */
export function NvSparkles() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span
        className="nv-spark"
        style={{ top: -4, right: 2, "--d": "0s" } as React.CSSProperties}
      />
      <span
        className="nv-spark"
        style={
          {
            top: 16,
            left: -8,
            width: 8,
            height: 8,
            background: "var(--nv-pop-lilac)",
            "--d": "1.15s",
          } as React.CSSProperties
        }
      />
      <span
        className="nv-spark"
        style={
          {
            bottom: 0,
            right: -6,
            width: 7,
            height: 7,
            background: "var(--nv-pop-mint)",
            "--d": "2.05s",
          } as React.CSSProperties
        }
      />
    </span>
  );
}

/* --- Confetti ---------------------------------------------------------------
   The celebration: ~two dozen pieces thrown UP from the hero (per-piece
   apex), gravity brings them past the bottom, whole thing over in ~2s and
   the component unmounts after. Randomness is fine here: this only ever
   renders client-side (behind useIsNative), so there is no hydration to
   disagree with. Under Reduce Motion the pieces hold opacity 0 — the
   celebration simply doesn't show. */
const CONFETTI_COLORS = [
  "var(--nv-accent-500)",
  "var(--nv-pop-sun)",
  "var(--nv-pop-mint)",
  "var(--nv-pop-sky)",
  "var(--nv-pop-lilac)",
  "var(--nv-pop-rose)",
  "var(--nv-pop-lime)",
];
const CONFETTI_SHAPES = ["square", "dot", "strip"] as const;

interface ConfettiPiece {
  x0: number;
  y0: number;
  lx: number;
  ly: number;
  dx: number;
  rotMid: number;
  rot: number;
  dur: number;
  delay: number;
  color: string;
  shape: (typeof CONFETTI_SHAPES)[number];
}

export function NvConfetti({
  count = 26,
  originY = 170,
}: {
  count?: number;
  /** Launch height in px from the top — roughly the hero it bursts from. */
  originY?: number;
}) {
  const [pieces] = useState<ConfettiPiece[]>(() =>
    Array.from({ length: count }, (_, i) => {
      // Fan the launch angles upward from the origin, stronger in the middle.
      const angle = (Math.random() - 0.5) * 2.2;
      const power = 90 + Math.random() * 160;
      const lx = Math.sin(angle) * power;
      return {
        x0: (Math.random() - 0.5) * 90,
        y0: originY + (Math.random() - 0.5) * 36,
        lx,
        ly: -(Math.cos(angle) * power * (0.7 + Math.random() * 0.5)) - 30,
        dx: lx * (1.7 + Math.random()),
        rotMid: 90 + Math.random() * 180,
        rot: 320 + Math.random() * 380,
        dur: 1.45 + Math.random() * 0.75,
        delay: Math.random() * 0.12,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        shape: CONFETTI_SHAPES[i % CONFETTI_SHAPES.length],
      };
    })
  );
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), 2600);
    return () => clearTimeout(t);
  }, []);

  if (gone) return null;
  return (
    <div className="nv-confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          data-shape={p.shape}
          style={
            {
              "--x0": `${p.x0.toFixed(0)}px`,
              "--y0": `${p.y0.toFixed(0)}px`,
              "--lx": `${p.lx.toFixed(0)}px`,
              "--ly": `${p.ly.toFixed(0)}px`,
              "--dx": `${p.dx.toFixed(0)}px`,
              "--rot-mid": `${p.rotMid.toFixed(0)}deg`,
              "--rot": `${p.rot.toFixed(0)}deg`,
              "--dur": `${p.dur.toFixed(2)}s`,
              "--delay": `${p.delay.toFixed(2)}s`,
              "--c": p.color,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
