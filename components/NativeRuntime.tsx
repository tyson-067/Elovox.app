"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIsNative } from "@/lib/native";
import { selection, tapLight } from "@/lib/haptics";
import { syncReminders } from "@/lib/reminders";

/**
 * The parts of "feels like an app" that live outside React's tree: the
 * splash handoff, the status bar, the keyboard, the edge-swipe back gesture,
 * and the tick under every tap.
 *
 * Renders nothing. It exists to own the native side effects in one place,
 * because each of them has to be undone as carefully as it was set up, and
 * scattering them through the screens that happen to care is how you end up
 * with a listener still holding a stale pathname three navigations later.
 *
 * Nothing in here runs in a browser — every effect returns early off
 * `useIsNative()`, and the plugins are dynamically imported so the website's
 * bundle never carries them.
 */
export function NativeRuntime() {
  const native = useIsNative();
  const pathname = usePathname();
  const router = useRouter();

  /* --- Splash handoff ----------------------------------------------------
     The app is a webview onto a remote site, so "launched" and "worth
     looking at" are a network round trip apart. Left alone the splash goes
     when the webview exists — i.e. onto a blank page the user then watches
     load, which is the experience of opening a browser.

     So the splash is held and this hides it once there is something behind
     it. It is a race, not a handover: capacitor.config.ts keeps the native
     3s timer as the backstop, because a splash that only JS can dismiss is
     one bad deploy away from a permanently frozen app.

     Two frames, not one — the first commits the tree, the second lets WebKit
     actually paint it. Hiding after one still occasionally reveals an
     unpainted page, which looks like a flash of the wrong colour. */
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let outer = 0;
    let inner = 0;

    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (cancelled) return;
        void import("@capacitor/splash-screen")
          .then(({ SplashScreen }) => SplashScreen.hide())
          .catch(() => {});
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    // Once, on the first mount of the session. A later navigation must never
    // re-run this: hide() on an already-hidden splash is harmless, but the
    // rAF pair would keep firing on every route change for no reason.
  }, [native]);

  /* --- Status bar --------------------------------------------------------
     The web app paints its own background up under the status bar (that is
     what viewport-fit=cover buys). So the status bar has to be transparent
     and its glyphs have to be chosen against whatever the app painted, or
     dark mode gets black text on a near-black bar.

     Capacitor's naming is the opposite of what it sounds like: Style.Dark
     means *light text, for dark backgrounds*. */
  useEffect(() => {
    if (!native) return;
    let disposed = false;

    const apply = () => {
      const dark =
        document.documentElement.getAttribute("data-theme") === "dark";
      void import("@capacitor/status-bar")
        .then(async ({ StatusBar, Style }) => {
          if (disposed) return;
          // The web layout already reserves env(safe-area-inset-top). Without
          // overlay the system inserts its own bar on top of that and the
          // title sits a status bar's height too low.
          await StatusBar.setOverlaysWebView({ overlay: true });
          await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
        })
        .catch(() => {});
    };

    apply();

    // The theme is a `data-theme` attribute written by Account (and by the
    // pre-paint script at launch), so the attribute is the event.
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // iOS resets the style on some returns from background — reasserting on
    // resume is cheaper than the one-in-twenty launch where it comes back
    // with black glyphs on the dark theme.
    let removeResume: (() => void) | undefined;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) apply();
        })
      )
      .then((handle) => {
        if (disposed) void handle.remove();
        else removeResume = () => void handle.remove();
      })
      .catch(() => {});

    return () => {
      disposed = true;
      observer.disconnect();
      removeResume?.();
    };
  }, [native]);

  /* --- Keyboard ----------------------------------------------------------
     Keyboard.resize is None, so WebKit leaves the viewport alone and this
     decides what moves. What should move: the dock gets out of the way (a
     tab bar floating on top of a keyboard is not a thing iOS does), and the
     page gets enough bottom padding that the focused field isn't behind the
     keys. What should not move: everything else. */
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];
    const root = document.documentElement;

    void import("@capacitor/keyboard")
      .then(async ({ Keyboard }) => {
        const show = await Keyboard.addListener("keyboardWillShow", (info) => {
          root.style.setProperty("--keyboard-height", `${info.keyboardHeight}px`);
          root.setAttribute("data-keyboard", "1");
        });
        const hide = await Keyboard.addListener("keyboardWillHide", () => {
          root.removeAttribute("data-keyboard");
          root.style.setProperty("--keyboard-height", "0px");
        });
        if (disposed) {
          void show.remove();
          void hide.remove();
          return;
        }
        handles.push(show, hide);
      })
      .catch(() => {});

    return () => {
      disposed = true;
      handles.forEach((h) => void h.remove());
      root.removeAttribute("data-keyboard");
      root.style.removeProperty("--keyboard-height");
    };
  }, [native]);

  /* --- Daily reminder ----------------------------------------------------
     The schedule is a window of discrete notifications, not one repeating
     entry, so it has to be topped up — and it goes stale in ways only a
     resume can catch: the day rolled over, the rep got done on another
     device, the user revoked notifications in Settings. Re-syncing on every
     activation is cheap (it is one cancel plus one schedule) and is the only
     thing that keeps "already practised today" from being nudged anyway. */
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let removeResume: (() => void) | undefined;

    void syncReminders();

    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) void syncReminders();
        })
      )
      .then((handle) => {
        if (disposed) void handle.remove();
        else removeResume = () => void handle.remove();
      })
      .catch(() => {});

    return () => {
      disposed = true;
      removeResume?.();
    };
  }, [native]);

  /* Tapping a reminder should land on today's drill, not on whatever screen
     the app was last left on — the notification made a promise. */
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let remove: (() => void) | undefined;

    void import("@capacitor/local-notifications")
      .then(({ LocalNotifications }) =>
        LocalNotifications.addListener(
          "localNotificationActionPerformed",
          ({ notification }) => {
            const route = notification.extra?.route;
            // Internal paths only. Today the only writer of `extra.route` is
            // lib/reminders.ts, but this handler fires for ANY notification
            // this app ever delivers — including whatever a future push
            // integration carries — and router.push with an absolute URL is
            // a full navigation. "/x" yes; "//host", "https:…" no.
            if (
              typeof route === "string" &&
              route.startsWith("/") &&
              !route.startsWith("//")
            ) {
              router.push(route);
            }
          }
        )
      )
      .then((handle) => {
        if (disposed) void handle.remove();
        else remove = () => void handle.remove();
      })
      .catch(() => {});

    return () => {
      disposed = true;
      remove?.();
    };
  }, [native, router]);

  /* --- The tick under every tap ------------------------------------------
     One delegated listener rather than a haptic call added to a few hundred
     controls. pointerdown, not click: the feedback has to land when the
     finger lands, not when it lifts, or it reads as lag rather than
     response.

     Capture phase so a control that stops propagation (several of the
     recorder's do) still gets its tick. */
  useEffect(() => {
    if (!native) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      const target = event.target as Element | null;
      const control = target?.closest?.(
        'button, a[href], [role="button"], [role="tab"], summary, ' +
          'input[type="checkbox"], input[type="radio"], input[type="range"]'
      );
      if (!control) return;
      if (control.hasAttribute("disabled")) return;
      if (control.getAttribute("aria-disabled") === "true") return;

      // A dock tab is a change of place, not an action — iOS marks those with
      // the lighter selection detent, and the difference is legible.
      if (control.closest(".native-dock")) selection();
      else tapLight();
    };

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
  }, [native]);

  /* --- Edge-swipe back ---------------------------------------------------
     Every iOS user tries this before they look for a back button, and its
     absence is one of the loudest tells a webview has. WKWebView's own
     allowsBackForwardNavigationGestures is deliberately not used: it drives
     the *webview's* history, which in a client-routed app disagrees with
     Next's router about where "back" is.

     The page tracks the finger rather than jumping when released, because a
     back gesture you can change your mind about halfway is the whole point
     of it being a gesture. */
  useEffect(() => {
    if (!native) return;

    const EDGE = 24; // How close to the left edge a drag must start.
    const COMMIT = 0.32; // Fraction of the width that counts as "go back".
    const surface = document.getElementById("main");
    if (!surface) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let decided = false; // Has this drag committed to horizontal?
    let width = 1;

    const reset = (animate: boolean) => {
      surface.style.transition = animate ? "transform 220ms ease-out" : "";
      surface.style.transform = "";
      if (animate) {
        window.setTimeout(() => {
          surface.style.transition = "";
        }, 240);
      }
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX > EDGE) return;
      // Nothing to go back to, and no chevron on screen either — the roots
      // and the auth screens both sit at the bottom of the stack.
      if (!document.querySelector('.native-bar-btn[aria-label="Back"]')) return;
      startX = touch.clientX;
      startY = touch.clientY;
      width = window.innerWidth || 1;
      tracking = true;
      decided = false;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!decided) {
        // Let a vertical drag win outright — otherwise every scroll that
        // starts near the edge fights the gesture.
        if (Math.abs(dy) > Math.abs(dx)) {
          tracking = false;
          return;
        }
        if (Math.abs(dx) < 8) return;
        decided = true;
      }

      if (dx <= 0) {
        surface.style.transform = "";
        return;
      }
      // Damped past the commit point: the page keeps answering the finger but
      // stops promising more than it will deliver.
      const eased = dx < width * COMMIT ? dx : width * COMMIT + (dx - width * COMMIT) * 0.35;
      surface.style.transform = `translate3d(${eased}px,0,0)`;
      if (event.cancelable) event.preventDefault();
    };

    const onEnd = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      tracking = false;
      if (decided && dx > width * COMMIT) {
        tapLight();
        reset(false);
        router.back();
      } else {
        reset(true);
      }
    };

    // passive: false on move only — it is the one that calls preventDefault,
    // and marking the others non-passive would cost scroll performance for
    // nothing.
    surface.addEventListener("touchstart", onStart, { passive: true });
    surface.addEventListener("touchmove", onMove, { passive: false });
    surface.addEventListener("touchend", onEnd, { passive: true });
    surface.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      surface.removeEventListener("touchstart", onStart);
      surface.removeEventListener("touchmove", onMove);
      surface.removeEventListener("touchend", onEnd);
      surface.removeEventListener("touchcancel", onEnd);
      reset(false);
    };
  }, [native, router]);

  /* --- Per-navigation reset ----------------------------------------------
     Two jobs, both keyed on the pathname because both are "a new screen just
     arrived".

     One: a committed swipe leaves the outgoing page translated, and the
     incoming one must not inherit that.

     Two: restart the enter animation. It cannot be left to CSS alone —
     React reuses a DOM node whenever the new tree matches the old shape, and
     a reused node keeps its finished animation and never replays it. Which
     routes happen to match is not something to build a transition on, so the
     animation is re-armed explicitly: strip the class, force a reflow so the
     removal is observed, add it back. */
  useEffect(() => {
    if (!native) return;
    const surface = document.getElementById("main");
    if (!surface) return;

    surface.style.transition = "";
    surface.style.transform = "";

    const screens = Array.from(surface.children) as HTMLElement[];
    screens.forEach((el) => el.classList.remove("native-screen-enter"));
    void surface.offsetWidth;
    screens.forEach((el) => el.classList.add("native-screen-enter"));
  }, [native, pathname]);

  /* --- Parallax ------------------------------------------------------------
     Anything marked data-parallax drifts against the scroll at its own
     factor (e.g. "0.08" = 8% of scroll distance, upward), which is what
     gives a flat screen its faint sense of depth. One passive scroll
     listener, one rAF, direct transform writes — React never hears about
     any of it, and Reduce Motion means it never arms at all. Re-queried per
     pathname: the marks belong to screens, and screens come and go. */
  useEffect(() => {
    if (!native) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // The marks mount AFTER this effect runs — most screens client-fetch
    // before they render their cards — so the list is collected lazily and
    // re-collected whenever it has gone stale (empty, or its first element
    // unmounted by a navigation). Steady-state cost per frame: one
    // isConnected check.
    let marks: { el: HTMLElement; f: number }[] = [];
    const collect = () => {
      marks = Array.from(
        document.querySelectorAll<HTMLElement>("[data-parallax]")
      )
        .map((el) => ({ el, f: parseFloat(el.dataset.parallax || "0") }))
        .filter((m) => m.f !== 0);
    };

    let raf = 0;
    let last = -1;
    const frame = () => {
      raf = 0;
      if (!marks.length || !marks[0].el.isConnected) {
        collect();
        if (!marks.length) return;
        last = -1; // force a write for the fresh set
      }
      const y = window.scrollY;
      if (y === last) return;
      last = y;
      for (const m of marks) {
        m.el.style.transform = `translate3d(0, ${(-y * m.f).toFixed(1)}px, 0)`;
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    frame();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      for (const m of marks) m.el.style.transform = "";
    };
  }, [native, pathname]);

  return null;
}
