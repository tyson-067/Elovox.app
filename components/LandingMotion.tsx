"use client";

import { useEffect } from "react";
import { reducedMotion } from "@/lib/motion";

// The landing page's cinematic layer, ported from the Claude Design project
// "Elovox.app UI overhaul" (Elovox Website.dc.html).
//
// It renders nothing. Everything it touches is already on the page, already
// readable, already laid out — this only adds the set pieces the stylesheet
// cannot express: a report that assembles itself as you scroll, six cards
// that travel sideways under a pin, and the small pointer manners (magnetic
// buttons, tilting price cards) that make a page feel handled rather than
// served.
//
// THE RULE, and it is the reason this file is shaped the way it is: motion
// may only ever ADD. Nothing here is load-bearing for reading the page. The
// generic scroll entrances are NOT done here — they use <Reveal>, which has
// its own stuck-observer failsafe (lib/useReveal.ts) — precisely because a
// `gsap.from({opacity: 0})` hung on a ScrollTrigger that never fires is a
// permanently invisible paragraph. GSAP owns only the effects whose start
// state is tied to a pin that either exists or doesn't, plus one entrance
// timeline that plays on mount and cannot stall.
//
// GSAP and anime.js are imported dynamically inside the effect: ~90 KB of
// animation engine has no business in the bundle that has to hydrate before
// the hero is interactive, and neither library is needed to render a frame.

/** Below this the pinned 100svh set pieces simply flow. Pinning a tall stage
 *  on a phone fights the browser's own chrome collapse and loses, and a
 *  pinned box taller than the window clips its own content with no way to
 *  scroll the rest into view. Media QUERIES, not an innerWidth read: the
 *  frame is still settling at first paint and a snapshot there never
 *  re-evaluates. */
const DESKTOP = "(min-width: 860px) and (min-height: 480px)";

export function LandingMotion() {
  useEffect(() => {
    let cancelled = false;
    // Everything built here is registered on the context so one revert()
    // undoes the whole file — tweens, ScrollTriggers, matchMedia branches and
    // every inline style GSAP wrote on the way.
    let ctx: { revert: () => void } | null = null;
    const cleanups: Array<() => void> = [];

    (async () => {
      const [{ gsap }, { ScrollTrigger }, { DrawSVGPlugin }, { CustomEase }, anime] =
        await Promise.all([
          import("gsap"),
          import("gsap/ScrollTrigger"),
          import("gsap/DrawSVGPlugin"),
          import("gsap/CustomEase"),
          import("animejs"),
        ]);
      if (cancelled) return;

      gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin, CustomEase);

      // The house ease. Named once so every tween in the file shares a
      // personality; falls back to power3 if CustomEase ever fails to load.
      let E = "power3.out";
      try {
        CustomEase.create("elo", "M0,0 C0.22,1 0.36,1 1,1");
        E = "elo";
      } catch {
        /* keep power3.out */
      }

      // The landing page's set pieces play for everyone — see lib/motion.ts
      // for the policy and for what the preference still governs.
      const reduce = reducedMotion();

      const q = <T extends Element>(s: string) =>
        document.querySelector<T>(s);
      const qa = <T extends Element>(s: string) =>
        Array.from(document.querySelectorAll<T>(s));

      // One failed effect must never take the rest of the page with it.
      const safe = (name: string, fn: () => void) => {
        try {
          fn();
        } catch (err) {
          console.error(`[elovox] landing motion: ${name} failed`, err);
        }
      };

      ctx = gsap.context(() => {
        const mm = gsap.matchMedia();

        // ---- hero entrance ------------------------------------------------
        // A plain timeline, no trigger: the hero is on screen at t=0, so
        // waiting for an intersection would only ever mean waiting. The h1
        // itself is a <WordReveal> and animates on its own.
        safe("hero", () => {
          if (reduce) return;
          const tl = gsap.timeline({ defaults: { ease: E } });
          tl.from("[data-lp-eyebrow]", { y: 14, opacity: 0, duration: 0.6 }, 0)
            .from(
              "[data-lp-serif]",
              { yPercent: 120, opacity: 0, skewY: 4, duration: 1.1 },
              0.42,
            )
            .from(
              "[data-lp-card]",
              { y: 54, opacity: 0, scale: 0.94, filter: "blur(14px)", duration: 1.15 },
              0.3,
            )
            // The brand line and the sentence under it arrive together, a
            // beat apart — one idea in two sizes, not two separate entrances.
            .from(
              "[data-lp-line]",
              { y: 20, opacity: 0, filter: "blur(8px)", duration: 0.8 },
              0.58,
            )
            .from(
              "[data-lp-sub]",
              { y: 20, opacity: 0, filter: "blur(8px)", duration: 0.8 },
              0.68,
            )
            .from(
              "[data-lp-cta] > *",
              { y: 18, opacity: 0, duration: 0.6, stagger: 0.1 },
              0.8,
            );
            // The hero fox used to land here on a back-ease at 0.95, after the
            // CTA. He is no longer on the card, and a tween whose target does
            // not exist is a silent no-op that outlives everyone who could
            // remember what it was for.

          // Failsafe. A throttled rAF — a background tab, a blocked frame —
          // must never leave the hero parked at its hidden start state.
          const t = setTimeout(() => {
            if (tl.progress() < 1) tl.progress(1);
          }, 4500);
          cleanups.push(() => clearTimeout(t));
        });

        // ---- the gradient travels slowly across the serif word ------------
        safe("gradient", () => {
          if (reduce) return;
          gsap.to("[data-lp-serif]", {
            backgroundPosition: "100% 50%",
            duration: 9,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
          });
        });

        // ---- hero waveform: randomised levels, so it reads as live audio --
        // The bars already move on a CSS equalizer. anime.js only takes them
        // over to make each bar's height genuinely different every cycle; the
        // CSS animation is cleared ONLY once anime.js actually owns them, so a
        // failed import leaves a moving waveform rather than a still one.
        safe("waveform", () => {
          const bars = qa<HTMLElement>("[data-lp-wave] > span");
          if (!bars.length || reduce) return;
          const running = anime.animate(bars, {
            scaleY: [
              () => 0.14 + Math.random() * 0.22,
              () => 0.42 + Math.random() * 0.58,
            ],
            duration: 560,
            loop: true,
            alternate: true,
            ease: "inOutSine",
            delay: anime.stagger(26),
          });
          if (running) {
            bars.forEach((b) => {
              b.style.animation = "none";
            });
            cleanups.push(() => {
              running.pause();
              bars.forEach((b) => {
                b.style.animation = "";
              });
            });
          }
        });

        // ---- the dimension ticker follows the scroll ----------------------
        // Speed and DIRECTION both. Scrolling up runs the marquee backwards,
        // which is the small trick that makes it feel attached to the page
        // rather than looping beside it.
        safe("ticker", () => {
          const t = q<HTMLElement>("[data-lp-ticker]");
          if (!t || reduce) return;
          // Hand the loop to GSAP so timeScale is ours to set; the CSS
          // animation was the no-JS state and has done its job.
          t.style.animation = "none";
          const loop = gsap.to(t, {
            xPercent: -50,
            duration: 30,
            ease: "none",
            repeat: -1,
          });
          ScrollTrigger.create({
            onUpdate: (self) => {
              const v = gsap.utils.clamp(-4, 4, self.getVelocity() / 320);
              const mag = 1 + Math.abs(v);
              loop.timeScale(v < -0.05 ? -mag : mag);
            },
          });
        });

        // ---- THE ACT: the report assembles itself, scrubbed by the bar ----
        // The centrepiece. Six scores, a marked-up quote and a total, built
        // in the order a reader would build them, at whatever speed the
        // scrollbar is moved. Desktop only — see DESKTOP above.
        safe("report", () => {
          const stage = q<HTMLElement>("[data-lp-report-stage]");
          if (!stage || reduce) return;
          mm.add(DESKTOP, () => {
            // The card and the fox arrive on their OWN trigger, played once
            // as the section comes up — deliberately not on the scrubbed
            // timeline below.
            //
            // A from() tween on a scrubbed timeline holds its start state for
            // as long as progress is 0, and progress is exactly 0 at the top
            // of the pin — which is precisely where the hero's "See what comes
            // back" and the nav's "The report" land you. With opacity in that
            // tween, the one link on the page that promises the report
            // delivered an empty dark stage.
            gsap.from("[data-lp-report-card]", {
              y: 70,
              scale: 0.93,
              opacity: 0,
              duration: 1,
              ease: E,
              scrollTrigger: { trigger: "[data-lp-report]", start: "top 80%" },
            });
            gsap.from("[data-lp-report-fox]", {
              x: -30,
              opacity: 0,
              duration: 0.8,
              ease: E,
              scrollTrigger: { trigger: "[data-lp-report]", start: "top 80%" },
            });

            const proxy = { v: 0 };
            const scoreEl = q<HTMLElement>("[data-lp-score]");
            const tl = gsap.timeline({
              defaults: { ease: E },
              scrollTrigger: {
                trigger: "[data-lp-report]",
                start: "top top",
                end: "+=2900",
                pin: stage,
                pinSpacing: true,
                scrub: 0.85,
                anticipatePin: 1,
                invalidateOnRefresh: true,
              },
            });

            // What the scrub owns is the ASSEMBLY, and every step of it moves
            // something that is already legible: the underlines draw across
            // words you can read, the bars fill beside numbers you can see,
            // the note and the verdict slide a few pixels. Nothing here fades
            // from nothing, so the top of the pin is a finished report that
            // has not been marked up yet rather than a blank card.
            tl.from(".lp-mark", { backgroundSize: "0% 3px", duration: 0.7, stagger: 0.4 }, 1.2)
              // Three notes now, one per mark, so they come in as a column
              // rather than all at once — and the stagger lands them in the
              // same order the underlines above were drawn.
              .from("[data-lp-note]", { y: 14, duration: 0.6, stagger: 0.18 }, 2.7)
              .from("[data-lp-scorerow]", { x: -18, duration: 0.5, stagger: 0.17 }, 3.2)
              .from("[data-lp-bar]", { scaleX: 0, duration: 0.75, stagger: 0.17, ease: E }, 3.3)
              .to(
                proxy,
                {
                  v: 86,
                  duration: 1.1,
                  ease: "power2.out",
                  onUpdate: () => {
                    // A scrubbed timeline renders once at time 0 when it is
                    // built, and that render calls this with proxy.v still 0 —
                    // which overwrote the real 86 in the markup with a "0"
                    // that then sat there for anyone who arrived by the
                    // #report anchor rather than by scrolling. Only write once
                    // the playhead has actually reached this tween.
                    if (scoreEl && tl.time() >= 4.6) {
                      scoreEl.textContent = String(Math.round(proxy.v));
                    }
                  },
                },
                4.6,
              )
              .from("[data-lp-verdict]", { y: 14, duration: 0.6 }, 5.1);
          });
        });

        // The drawn rail lived here: a gradient line that filled itself down
        // the four "How it works" steps as the section passed. That section is
        // off the homepage, so the effect went with it rather than staying to
        // query a #how that no longer exists.

        // ---- six ways to practice: pinned horizontal scroll ---------------
        // Without a pin there is no horizontal scrub, so the row has to be
        // swipeable or six cards sit clipped behind the section's overflow.
        // Swipeable IS the rendered state; the pin is what turns it off.
        safe("modes", () => {
          const track = q<HTMLElement>("[data-lp-modes-track]");
          const sec = q<HTMLElement>("[data-lp-modes]");
          const sc = q<HTMLElement>("[data-lp-modes-scroller]");
          if (!track || !sec || reduce) return;

          mm.add(DESKTOP, () => {
            sc?.classList.add("is-pinned");
            const dist = () =>
              Math.max(0, track.scrollWidth - window.innerWidth + 48);
            gsap.to(track, {
              x: () => -dist(),
              ease: "none",
              scrollTrigger: {
                trigger: sec,
                start: "top top",
                end: () => "+=" + (dist() + 500),
                pin: true,
                scrub: 1,
                invalidateOnRefresh: true,
                anticipatePin: 1,
              },
            });
            return () => sc?.classList.remove("is-pinned");
          });
        });

        // Felix's story used to live here: four beats and four moods of the
        // fox, cross-faded under a pin. The section came off the homepage —
        // the front door sells the product and the reader's own objective,
        // not the mascot's biography — so the effect that drove it went with
        // it rather than sitting here querying selectors that no longer
        // exist. The copy is kept in lib/felixStory.ts for the About page.
        // (.lp-beats / .lp-foxes are still in globals.css for the same
        // reason.)

        // ---- impact-mode pills stagger in ---------------------------------
        // TRANSFORM ONLY. This used to set opacity 0 and animate back to 1,
        // which made eight readable, clickable buttons depend on anime.js
        // arriving — the exact shape this file's own rule forbids. It was
        // invisible while reduced motion skipped the whole block; the moment
        // the site started playing its motion for everyone,
        // tests/e2e/reduced-motion.spec.ts caught the last pill still at
        // opacity 0 a second after the trigger fired. A failed import, a slow
        // phone or a reader who scrolls fast would all have seen the same
        // thing.
        //
        // So the pills are never hidden. They travel and settle instead, which
        // is the same bargain the report's scrub already makes: everything it
        // animates is legible before it moves.
        safe("goals", () => {
          const pills = qa<HTMLElement>("[data-lp-goal]");
          if (!pills.length || reduce) return;
          ScrollTrigger.create({
            trigger: "[data-lp-goals]",
            start: "top 88%",
            once: true,
            onEnter: () => {
              anime.animate(pills, {
                y: [16, 0],
                scale: [0.94, 1],
                duration: 620,
                ease: "outElastic(1, 0.7)",
                delay: anime.stagger(45),
              });
            },
          });
        });

        // ---- price cards: pointer tilt + cursor spotlight -----------------
        // GlowCard does the spotlight for the rest of the product, but these
        // cards also tilt, and one transform owner per element is the rule —
        // so the same handler writes --mx/--my and the rotation together.
        safe("tilt", () => {
          if (reduce) return;
          qa<HTMLElement>("[data-lp-tilt]").forEach((card) => {
            const spot = card.querySelector<HTMLElement>(".lp-spot");
            const enter = () => {
              if (spot) spot.style.opacity = "1";
            };
            const leave = () => {
              if (spot) spot.style.opacity = "0";
              gsap.to(card, {
                rotateX: 0,
                rotateY: 0,
                duration: 0.8,
                ease: "elastic.out(1,0.55)",
              });
            };
            const move = (e: PointerEvent) => {
              const r = card.getBoundingClientRect();
              const px = (e.clientX - r.left) / r.width - 0.5;
              const py = (e.clientY - r.top) / r.height - 0.5;
              card.style.setProperty("--mx", `${(px + 0.5) * 100}%`);
              card.style.setProperty("--my", `${(py + 0.5) * 100}%`);
              gsap.to(card, {
                rotateY: px * 7,
                rotateX: -py * 7,
                transformPerspective: 1000,
                duration: 0.5,
                ease: "power2.out",
              });
            };
            card.addEventListener("pointerenter", enter);
            card.addEventListener("pointerleave", leave);
            card.addEventListener("pointermove", move);
            cleanups.push(() => {
              card.removeEventListener("pointerenter", enter);
              card.removeEventListener("pointerleave", leave);
              card.removeEventListener("pointermove", move);
            });
          });
        });

        // ---- magnetic CTAs -------------------------------------------------
        // The button leans toward the cursor and springs back. Bounded to a
        // sixth of the pointer's offset horizontally so it never leaves its
        // own hit area — a button that dodges the click is a worse button.
        safe("magnet", () => {
          if (reduce) return;
          qa<HTMLElement>("[data-lp-magnet]").forEach((btn) => {
            const arrow = btn.querySelector<HTMLElement>("[data-lp-arrow]");
            const move = (e: PointerEvent) => {
              const r = btn.getBoundingClientRect();
              gsap.to(btn, {
                x: (e.clientX - r.left - r.width / 2) * 0.16,
                y: (e.clientY - r.top - r.height / 2) * 0.24,
                duration: 0.45,
                ease: "power2.out",
              });
              if (arrow) gsap.to(arrow, { x: 2.5, y: -2.5, duration: 0.3, ease: "power2.out" });
            };
            const leave = () => {
              gsap.to(btn, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1,0.45)" });
              if (arrow) gsap.to(arrow, { x: 0, y: 0, duration: 0.4 });
            };
            btn.addEventListener("pointermove", move);
            btn.addEventListener("pointerleave", leave);
            cleanups.push(() => {
              btn.removeEventListener("pointermove", move);
              btn.removeEventListener("pointerleave", leave);
            });
          });
        });
      });

      // Web fonts change text metrics, which changes every pinned distance
      // this file just measured.
      if (document.fonts?.ready) {
        document.fonts.ready.then(() => ScrollTrigger.refresh()).catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
      ctx?.revert();
    };
  }, []);

  return null;
}
