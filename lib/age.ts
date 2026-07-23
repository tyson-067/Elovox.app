"use client";

import { useSyncExternalStore } from "react";
import { LEGAL } from "./legal";

// Age gate for signup. Elovox records voices, and under-13 accounts would
// pull COPPA (and its parental-consent machinery) into scope, so the terms
// set a floor and this is what enforces it at the door.
//
// Deliberately NOT stored: we ask for a date of birth, use it once to
// compute an age, and throw it away. Keeping birth dates would mean holding
// more personal data about minors than we need — the opposite of what the
// privacy policy promises. The only trace kept is the boolean below.
//
// This is a neutral age screen, not a security control. Anyone can type a
// different date, and no client-side check can prove an age. What it does is
// stop us from *knowingly* signing up a child, which is the standard the law
// actually applies.

export const MINIMUM_AGE = LEGAL.minimumAge;

/** Youngest date of birth that still clears the minimum age, as YYYY-MM-DD. */
export function latestAllowedDob(today = new Date()): string {
  const d = new Date(today);
  d.setFullYear(d.getFullYear() - MINIMUM_AGE);
  return d.toISOString().slice(0, 10);
}

/**
 * Whole years between `dob` and today, or null if the input isn't a usable
 * date. Counts a birthday as reached only once the day arrives.
 */
export function ageFromDob(dob: string, today = new Date()): number | null {
  const born = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  if (born > today) return null;
  // Sanity ceiling — a typo'd century shouldn't read as a valid age.
  if (today.getFullYear() - born.getFullYear() > 120) return null;

  let age = today.getFullYear() - born.getFullYear();
  const monthDiff = today.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < born.getDate())) {
    age -= 1;
  }
  return age;
}

const BLOCK_KEY = "elovox.age.blocked.v1";

/**
 * Remember that this browser failed the age check, so the form stays closed
 * instead of inviting an immediate retry with a different date. A soft
 * deterrent — clearing site data resets it — but re-prompting a child who
 * just told us their age would defeat the point of asking.
 */
export function rememberAgeBlock(): void {
  try {
    window.localStorage.setItem(BLOCK_KEY, "1");
  } catch {
    /* private mode / storage disabled — the gate still ran this session */
  }
  listeners.forEach((fn) => fn());
}

function isAgeBlocked(): boolean {
  try {
    return window.localStorage.getItem(BLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

// localStorage is an external store, so it's read through
// useSyncExternalStore rather than an effect: no setState-in-effect, no
// hydration mismatch (the server snapshot is always false, and the client
// re-reads immediately after mount).
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Catch the flag being set in another tab as well as in this one.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** True once this browser has failed the age check. */
export function useAgeBlocked(): boolean {
  return useSyncExternalStore(subscribe, isAgeBlocked, () => false);
}

/** Shown to anyone under the minimum age. Final — there's no retry path. */
export const AGE_BLOCK_MESSAGE = `Sorry — you need to be at least ${MINIMUM_AGE} to use Elovox.`;

/** Shown to 13–17 year olds, who may sign up with permission. */
export const MINOR_NOTICE =
  "You're under 18, so please make sure a parent or guardian is okay with you using Elovox.";
