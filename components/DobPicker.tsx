"use client";

import { useId } from "react";

// Three scroll wheels — day, month, year — in place of `<input type="date">`.
//
// The native date input is the wrong control for a birthday. On a phone it
// opens a wheel that starts on *today* and reports every value it rolls
// through on the way back, so a 34-year-old scrolling to 1991 emits a run of
// "born last week" answers first. That stream of fake ages is what the age
// gate kept tripping over. On a desktop it's a calendar that opens on this
// month and asks someone to page back four hundred times.
//
// These wheels are `<select>`s, which is the same gesture on a phone (iOS and
// Android both render a picker), a normal dropdown on a desktop, and on both
// they report exactly one thing: the value that was chosen. Nothing is emitted
// in transit, so there are no half-finished dates for anything downstream to
// misread. Years run newest-first, because the people using this were born
// nearer the top of that list than the bottom.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Oldest birth year offered. Comfortably past any documented human lifespan. */
const YEAR_SPAN = 120;

/**
 * Days in a given month, defaulting to 31 until both parts are known. Kept
 * honest about February so 29–31 don't sit in the list waiting to produce a
 * date that doesn't exist.
 */
function daysInMonth(year: number, month: number): number {
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

const selectClass =
  "card input-glow w-full appearance-none bg-transparent px-3 py-3 text-base text-on-surface focus:outline-none";

export interface DobParts {
  day: string;
  month: string;
  year: string;
}

/** "" until all three wheels are set, otherwise the ISO date they spell. */
export function dobPartsToIso({ day, month, year }: DobParts): string {
  if (!day || !month || !year) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function DobPicker({
  value,
  onChange,
  describedBy,
}: {
  value: DobParts;
  onChange: (next: DobParts) => void;
  describedBy?: string;
}) {
  const id = useId();
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: YEAR_SPAN + 1 }, (_, i) => thisYear - i);
  const dayCount = daysInMonth(Number(value.year), Number(value.month));
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);

  // Changing month or year can strip the bottom off the day list (31 → 30, or
  // out of a leap February). Drop a day that no longer exists rather than
  // leaving a selection pointing at an option that isn't there any more.
  const update = (next: DobParts) => {
    const limit = daysInMonth(Number(next.year), Number(next.month));
    onChange(Number(next.day) > limit ? { ...next, day: "" } : next);
  };

  return (
    <div className="mt-1.5 grid grid-cols-[1fr_1.4fr_1fr] gap-2">
      <div className="relative">
        <label htmlFor={`${id}-day`} className="sr-only">
          Day of birth
        </label>
        <select
          id={`${id}-day`}
          required
          aria-describedby={describedBy}
          value={value.day}
          onChange={(e) => update({ ...value, day: e.target.value })}
          className={selectClass}
        >
          <option value="">Day</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <label htmlFor={`${id}-month`} className="sr-only">
          Month of birth
        </label>
        <select
          id={`${id}-month`}
          required
          aria-describedby={describedBy}
          value={value.month}
          onChange={(e) => update({ ...value, month: e.target.value })}
          className={selectClass}
        >
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <label htmlFor={`${id}-year`} className="sr-only">
          Year of birth
        </label>
        <select
          id={`${id}-year`}
          required
          aria-describedby={describedBy}
          value={value.year}
          onChange={(e) => update({ ...value, year: e.target.value })}
          className={selectClass}
        >
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
