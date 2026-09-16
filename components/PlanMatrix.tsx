"use client";

import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import {
  PLANS,
  TRIAL_DAYS,
  savingsVsWeekly,
  formatUSD,
  type BillingCycle,
  type PricingPlan,
} from "@/lib/pricing";

// "Every Premium plan compared", as a component rather than as markup that
// exists twice.
//
// It renders the same argument in two places and two registers:
//
//   variant="page"     /pricing — the canonical comparison, the thing the
//                      page is for. Quiet, dense, no set piece.
//   variant="landing"  / — the alternate cut. Same three plans, same numbers,
//                      but staged: bars that fill to the proportions they
//                      encode, and per-week rates that count down from the
//                      weekly price to what each cycle actually costs.
//
// A CLIENT COMPONENT WITH NO STATE AND NO EFFECTS, which is the whole trick
// of the file. "use client" is here only because /pricing needs to pass an
// onSelect — there is no useState, no useEffect and nothing that waits for
// hydration, so every branch below still renders its finished state in the
// server HTML: real prices, real bar widths, real per-week rates. The landing page's animation is added
// afterwards by components/LandingMotion.tsx, which finds these nodes by
// their `data-lp-plan-*` attributes and animates them from a start state it
// sets itself. So the section costs nothing in the bundle, is complete
// before hydration, and survives GSAP failing to load, a stalled
// IntersectionObserver, or a reader who scrolls past faster than a trigger
// can fire. Nothing here is ever at opacity 0 waiting for a callback — see
// the rule at the top of LandingMotion.tsx, and the blank-page incident that
// put it there.
//
// This carried a plotted "descent curve" over the columns — the effective
// weekly rate as a falling line, drawn on scroll. It was removed at Tyson's
// request on 2026-09-15. The argument it made is still made, by the bars and
// by the "Save N% vs weekly" line, both of which are computed from the same
// numbers; the chart was a third telling of it that cost a 210-unit SVG, an
// axis label that collided with its own first vertex, and four extra
// animation targets. If it ever comes back, note that its geometry was
// derived from PLANS rather than hand-placed, which is the part worth
// keeping: lib/pricing.ts is the single source of truth for prices, and a
// chart with hardcoded vertices stops telling the truth the first time a
// price moves.

/** Bar width as a share of the priciest plan's weekly rate. Inline style, not
 *  a class: the value is derived from pricing data, so it cannot be a
 *  Tailwind utility without hardcoding the answer. */
function barWidth(plan: PricingPlan, max: number) {
  return `${((plan.perWeek / max) * 100).toFixed(1)}%`;
}

function Arrow({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-lp-arrow
    >
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

const GRID_CLASS =
  "grid grid-cols-1 gap-[clamp(12px,1.6vw,20px)] sm:grid-cols-3";

/** The three-up container. A group of toggle buttons when the cards select a
 *  cycle, a plain list when they only display one. */
function Grid({
  selectable,
  className = "",
  children,
}: {
  selectable: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  if (selectable) {
    return (
      <div
        role="group"
        aria-label="Billing cycle"
        className={`${GRID_CLASS} ${className}`}
      >
        {children}
      </div>
    );
  }
  return <ul className={`${GRID_CLASS} list-none ${className}`}>{children}</ul>;
}

/** One plan card. A <button> that reports its pressed state when it selects,
 *  an <li> when it does not.
 *
 *  The data-lp-* attributes are forwarded rather than declared, because they
 *  are the contract with components/LandingMotion.tsx and it queries the
 *  document for them by name — a prop spread is the only way to keep that
 *  contract identical across both shapes. */
function Cell({
  selectable,
  active,
  onSelect,
  className,
  children,
  ...rest
}: {
  selectable: boolean;
  active: boolean;
  onSelect?: () => void;
  className: string;
  children: React.ReactNode;
} & Record<string, unknown>) {
  if (selectable) {
    return (
      <button type="button" aria-pressed={active} onClick={onSelect} className={className} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <li className={className} {...rest}>
      {children}
    </li>
  );
}

export interface PlanMatrixProps {
  variant?: "landing" | "page";
  /** The cycle currently chosen. /pricing passes its toggle state so the two
   *  controls stay in sync; the landing page has no state and passes none. */
  activeCycle?: BillingCycle;
  /** The cycle the visitor is actually SUBSCRIBED to, which is a different
   *  question from which one they are looking at. When it matches, the card
   *  says "Current plan" instead of showing the marketing badge — offering
   *  "Best value" on the plan someone already pays for reads as an upsell to
   *  where they already are. */
  currentCycle?: BillingCycle;
  /** Makes the cards a second selector for the cycle. Omitted on the landing
   *  page, where there is no state to select into and the whole section is a
   *  pitch rather than a control. */
  onSelect?: (cycle: BillingCycle) => void;
  /** Rendered under the grid. */
  footnote?: React.ReactNode;
  className?: string;
}

export function PlanMatrix({
  variant = "page",
  activeCycle,
  currentCycle,
  onSelect,
  footnote,
  className = "",
}: PlanMatrixProps) {
  const staged = variant === "landing";
  const max = Math.max(...PLANS.map((p) => p.perWeek));
  const weekly = PLANS[0].perWeek;

  return (
    // web-only belongs on the ROOT, not on a card inside it. Every descendant
    // carries a price or the words "per week", and App Store guideline 3.1.1
    // does not care which element it was on. tests/e2e/app-store-gate.spec.ts
    // asserts the whole thing disappears the moment the shell stamps
    // data-native on <html>.
    <div
      className={`web-only ${className}`}
      data-lp-plan-matrix={staged ? "" : undefined}
    >
      {/* ---------- the grid ---------- */}
      {/* Two shapes, chosen by whether the cards DO anything.
          Selectable, they are a group of toggle buttons: role="group" +
          aria-pressed, exactly the pattern the cycle toggle on /pricing
          already uses and for the same reason it gives there — role="tablist"
          would announce "tab 1 of 3" and promise arrow-key navigation and a
          tabpanel that do not exist.
          Inert, they are a plain list, because a <button> nobody can press is
          a lie told to a screen reader. */}
      <Grid selectable={!!onSelect} className={staged ? "" : "mt-5"}>
        {PLANS.map((plan, i) => {
          const saved = savingsVsWeekly(plan);
          const dark = staged && plan.highlight;
          const active = activeCycle === plan.cycle;
          const isCurrent = currentCycle === plan.cycle;

          return (
            <Reveal key={plan.cycle} delay={staged ? i * 90 : i * 100} className="h-full">
              <Cell
                selectable={!!onSelect}
                active={active}
                onSelect={onSelect ? () => onSelect(plan.cycle) : undefined}
                data-lp-plan-col={staged ? "" : undefined}
                data-lp-tilt={staged ? "" : undefined}
                className={[
                  "relative flex h-full w-full flex-col overflow-hidden rounded-3xl p-[clamp(20px,2.3vw,30px)] text-left will-change-transform",
                  dark
                    ? "bg-[linear-gradient(155deg,#0b0829_0%,#004e89_38%,#1a659e_62%,#8fa0d8_86%,#f9dfc6_100%)] bg-[length:160%_160%] text-white shadow-[0_30px_60px_-30px_rgba(11,8,41,0.6)]"
                    : "border border-primary/15 bg-white shadow-[0_24px_50px_-34px_rgba(11,8,41,0.38)]",
                  active && !dark ? "border-accent! ring-2 ring-accent/25" : "",
                  onSelect && !active ? "transition-colors hover:border-violet/40" : "",
                ].join(" ")}
              >
                {staged && (
                  <div
                    className={`lp-spot ${dark ? "lp-spot-light" : ""}`}
                    aria-hidden="true"
                  />
                )}

                {/* --- label + badge --- */}
                <div className="relative flex items-start justify-between gap-3">
                  <h3
                    className={`font-headline text-[clamp(17px,1.5vw,21px)] font-bold tracking-[-0.02em] ${
                      dark ? "text-white" : "text-primary"
                    }`}
                  >
                    {plan.label}
                  </h3>
                  {isCurrent ? (
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${
                        dark ? "bg-white/25 text-white" : "bg-accent/12 text-accent-strong"
                      }`}
                    >
                      Current plan
                    </span>
                  ) : (
                    plan.badge && (
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${
                          dark
                            ? "bg-white/20 text-white"
                            : "bg-violet/12 text-violet-strong"
                        }`}
                      >
                        {plan.badge}
                      </span>
                    )
                  )}
                </div>

                {/* --- headline price --- */}
                {/* tabular-nums so three prices of different digit counts sit
                    on the same optical grid across the row.

                    Two size ramps, because the two variants have very
                    different column widths. The landing page runs the grid at
                    the full page measure and can afford the display size; on
                    /pricing the same grid is max-w-4xl, which leaves roughly
                    250px a column, and "$11.99" in a monospace face at 3.1rem
                    took all of it — the "/ month" beside it broke between the
                    slash and the word. whitespace-nowrap on the unit is the
                    belt: a billing period split across two lines reads as a
                    different price. */}
                <p
                  className={`relative mt-3.5 flex items-baseline gap-[7px] font-data font-medium leading-none tracking-[-0.03em] tabular-nums ${
                    dark ? "text-white" : "text-primary"
                  }`}
                >
                  <span
                    className={
                      staged
                        ? "text-[clamp(2.1rem,3.4vw,3.1rem)]"
                        : "text-[clamp(1.75rem,2.4vw,2.35rem)]"
                    }
                  >
                    {formatUSD(plan.price)}
                  </span>
                  <span
                    className={`whitespace-nowrap text-[13px] ${
                      dark ? "text-white/85" : "text-on-surface-variant"
                    }`}
                  >
                    / {plan.unit}
                  </span>
                </p>

                {/* --- the comparable rate + its bar --- */}
                {/* The bar is the only thing in the card that is pure
                    decoration, so it is the only thing allowed to animate
                    from zero. The number beside it is already correct in the
                    HTML; anime.js counts it DOWN from the weekly rate on the
                    landing page, which is legible either way because the
                    resting value is the true one. */}
                <div className="relative mt-4">
                  <p
                    className={`font-data text-[12.5px] font-medium tabular-nums ${
                      dark ? "text-white/90" : "text-on-surface-variant"
                    }`}
                  >
                    <span
                      data-lp-plan-rate={staged ? plan.perWeek.toFixed(2) : undefined}
                      data-lp-plan-from={staged ? weekly.toFixed(2) : undefined}
                    >
                      {formatUSD(Number(plan.perWeek.toFixed(2)))}
                    </span>{" "}
                    per week
                  </p>
                  <div
                    className={`mt-2 h-[6px] w-full overflow-hidden rounded-full ${
                      dark ? "bg-white/15" : "bg-primary/8"
                    }`}
                  >
                    <div
                      data-lp-plan-bar={staged ? "" : undefined}
                      style={{ width: barWidth(plan, max) }}
                      className={`h-full origin-left rounded-full ${
                        dark
                          ? "bg-[linear-gradient(90deg,var(--color-orange),var(--color-shrimp))]"
                          : "bg-[linear-gradient(90deg,var(--color-accent),var(--color-violet))]"
                      }`}
                    />
                  </div>
                </div>

                {/* --- the verdict line --- */}
                <p
                  className={`relative mt-4 text-[13px] font-semibold ${
                    dark
                      ? "text-shimmer"
                      : saved > 0
                        ? "text-accent-strong"
                        : "text-on-surface-variant"
                  }`}
                >
                  {saved > 0 ? `Save ${saved}% vs weekly` : "Pay as you go"}
                </p>

                {/* --- trial / billing truth --- */}
                {/* mt-auto pins this to the bottom of whichever card is
                    tallest, so the three lines sit on one baseline instead of
                    floating at three different heights. */}
                <p
                  className={`relative mt-auto pt-5 text-[12px] leading-[1.5] ${
                    dark ? "text-white/80" : "text-on-surface-variant"
                  }`}
                >
                  {plan.trialDays > 0
                    ? `${plan.trialDays}-day free trial, then ${formatUSD(plan.price)} per ${plan.unit}`
                    : "Billed from day one, cancel anytime"}
                </p>
              </Cell>
            </Reveal>
          );
        })}
      </Grid>

      {footnote}

      {/* ---------- what the money buys ---------- */}
      {/* Landing only. A price with no object is just a number: the grid above
          says what three cycles cost and nothing at all about what is being
          bought, and on /pricing the feature list is the section above this
          one. Kept to four lines and one CTA — the full list is what /pricing
          is for, and this section's job is to send people there. */}
      {staged && (
        <Reveal delay={380}>
          <div className="mt-[clamp(18px,2.2vw,28px)] rounded-3xl border border-primary/12 bg-white/60 p-[clamp(20px,2.4vw,32px)]">
            <p className="font-data text-[10.5px] font-medium uppercase tracking-[0.16em] text-on-surface-variant">
              Every plan above includes
            </p>
            <ul className="mt-[18px] grid list-none grid-cols-1 gap-x-8 gap-y-[11px] text-[15px] leading-[1.5] text-oxford sm:grid-cols-2">
              {[
                <>
                  <span className="font-semibold">Camera coaching:</span> posture,
                  sway, gestures, eye contact, expression
                </>,
                <>
                  Felix&apos;s deeper report: strengths, targeted drills, a longer
                  read on every dimension
                </>,
                <>
                  The full speech library, plus interview and social skills
                  practice
                </>,
                <>
                  Coaching on your own material, and custom speeches Felix writes
                </>,
              ].map((line, i) => (
                <li key={i} className="flex gap-[11px]">
                  <span
                    aria-hidden="true"
                    className="mt-[9px] h-[5px] w-[5px] flex-none rounded-full bg-accent"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-[26px] flex flex-wrap items-center gap-x-4 gap-y-3">
              <Link
                href="/signup"
                data-lp-magnet
                className="inline-flex items-center gap-[11px] rounded-full bg-accent-strong py-2.5 pl-6 pr-2.5 text-[15px] font-semibold text-on-primary"
              >
                Start free
                <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white/20">
                  <Arrow />
                </span>
              </Link>
              <Link
                href="/pricing"
                data-lp-magnet
                className="inline-flex items-center gap-2 rounded-full border border-primary/20 px-5 py-2.5 text-[15px] font-semibold text-primary"
              >
                Compare in full
                <Arrow />
              </Link>
              {/* The free tier is still the product; this section only sells
                  the paid cycles, so the one line that keeps it honest says
                  so rather than leaving a reader to assume Elovox is paid. */}
              <p className="text-[12.5px] leading-[1.5] text-on-surface-variant">
                Free forever on the Daily Minute. {TRIAL_DAYS}-day trial on
                monthly and annual. Plus sales tax.
              </p>
            </div>
          </div>
        </Reveal>
      )}
    </div>
  );
}
