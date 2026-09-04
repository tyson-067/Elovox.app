"use client";

import { useState } from "react";
import Link from "next/link";
import { FelixMark } from "@/components/FoxLogo";
import { GOALS } from "@/lib/goals";
import type { GoalId } from "@/lib/types";

// The impact modes: the thing that makes Elovox something other than a filler
// word counter. The speaker says what they want the listener to feel, think or
// do; everything the product measures afterwards is judged against that.
//
// The eight modes are lib/goals.ts — the SAME array the analysis pipeline
// scores against (app/api/analyze). They are not marketing copy with a
// matching set in the app, they are the app's own list, which is why this
// renders GOALS rather than restating it.
//
// Interactivity is deliberately shallow. Picking a mode here does not start a
// session, store anything, or call anything: it acknowledges the choice in
// Felix's voice and shows the pill selected, which is the smallest honest
// demonstration of "choose your impact" a marketing page can give. Anything
// more would be a second product living on the front door.

/** Felix's answer to each pick. One line, his voice, no interface around it.
 *  Keyed by GoalId so a new mode in lib/goals.ts shows up here immediately —
 *  with the generic line below until someone writes it one of its own. */
const FELIX_ACK: Partial<Record<GoalId, string>> = {
  trust: "Got it. Let's practice for trust.",
  agree: "Got it. Let's practice for agreement.",
  inspire: "Got it. Let's practice for action.",
  leader: "Got it. Let's work on sounding like a leader.",
  empathy: "Got it. Let's practice for empathy.",
  intelligent: "Got it. Let's work on sounding sharper.",
  memorable: "Got it. Let's make it stick.",
  calm: "Got it. Let's bring the room down.",
};

export function ImpactModes() {
  const [picked, setPicked] = useState<GoalId | null>(null);
  const ack = picked
    ? (FELIX_ACK[picked] ?? "Got it. Let's practice for that.")
    : null;

  return (
    <div className="grid grid-cols-1 items-center gap-[clamp(28px,4vw,64px)] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div>
        <p className="font-data text-[11.5px] font-medium uppercase tracking-[0.16em] text-on-surface-variant">
          Impact modes
        </p>
        <h2 className="mt-[18px] font-headline text-[clamp(1.7rem,2.6vw,2.7rem)] font-extrabold leading-[1.08] tracking-[-0.03em] text-primary">
          Tell Felix what you&apos;re going for.
        </h2>

        {/* The idea the whole product sits on, said once on the page.

            The body face at regular weight, in the same lighter ink as the
            hero's supporting line — not the Montserrat headline face it was
            first set in, and emphatically not the Playfair italic the page
            uses on "impact." and "this.". That serif is a display lockup and
            earns three or four words; a nine-word sentence in it stops being
            read and starts being looked at.

            What sets the line apart now is the accent rule and the size, not
            weight and a near-black ink. It is quieter than the h2 above it on
            purpose: the heading is the instruction, this is the reason. */}
        <p className="mt-5 border-l-2 border-accent pl-[18px] text-[clamp(19px,1.7vw,26px)] leading-[1.5] text-on-surface-variant">
          People hear you emotionally before they hear you logically.
        </p>

        <p className="mt-[18px] max-w-[46ch] text-[16.5px] leading-[1.65] text-on-surface-variant">
          Choose the impact you want. Felix coaches your delivery toward it.
        </p>
      </div>

      <div>
        {/* data-lp-goals / data-lp-goal are LandingMotion's handles for the
            stagger-in. They stay on the buttons: the effect hides and animates
            inside one callback, so if it never runs the pills are simply
            there, clickable, in their default state. */}
        <div data-lp-goals className="flex flex-wrap gap-2.5">
          {GOALS.map((goal) => {
            const on = picked === goal.id;
            return (
              <button
                key={goal.id}
                type="button"
                data-lp-goal
                aria-pressed={on}
                onClick={() => setPicked(on ? null : goal.id)}
                className={`cursor-pointer rounded-full px-[18px] py-[11px] text-[15px] transition-colors duration-200 ${
                  on
                    ? "border border-primary bg-primary text-on-primary"
                    : "border border-primary/20 bg-white/55 text-primary hover:border-primary/45 hover:bg-white"
                }`}
              >
                {goal.label}
              </button>
            );
          })}
        </div>

        {/* Felix answers. One line, one small head, and a reserved height so
            picking a mode doesn't shove the page — the row is the same size
            empty as it is full. */}
        <p
          role="status"
          aria-live="polite"
          className="mt-5 flex min-h-[34px] items-center gap-2.5 text-[15px] leading-[1.4] text-on-surface-variant"
        >
          {ack ? (
            <>
              <FelixMark mood="coach" className="h-[30px] w-[30px] flex-none" />
              <span>{ack}</span>
            </>
          ) : (
            <span className="text-[14px]">
              Pick one and Felix will judge every rep against it.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/** The hero's secondary call to action. A real `#impact` anchor — it works
 *  with JavaScript off and it is a link, not a button — upgraded on click to
 *  a smooth scroll, which a plain hash jump does not do and which the page
 *  has no global `scroll-behavior: smooth` for. (It deliberately doesn't:
 *  smooth scrolling the whole document fights GSAP's pinned sections.)
 *
 *  `scrollIntoView` honours the section's own scroll-margin-top, so the
 *  floating nav pill doesn't land on top of the heading. */
export function ImpactCta({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href="#impact"
      className={className}
      onClick={(e) => {
        const target = document.getElementById("impact");
        // No target means the section moved or hasn't rendered. Let the
        // browser do what the href says rather than swallowing the click.
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
        // replaceState, not pushState: this is a jump within the page the
        // visitor is already on, and it should not cost them a Back press.
        history.replaceState(null, "", "#impact");
      }}
    >
      {children}
    </Link>
  );
}
