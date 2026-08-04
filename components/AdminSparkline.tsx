"use client";

// A small single-series bar chart for the admin dashboard (signups/day,
// sessions/day, pipeline runs/day). Follows the dataviz method for this
// form: change-over-time magnitude → bars; ONE series, so identity is
// carried by the tile's title and there is no legend; the mark wears
// --color-accent (the palette's documented "marks" hue) while every number
// and label stays in text tokens; bars are thin, baseline-anchored, with
// rounded data-ends and a 2-bar-gap; hover identity comes from a per-mark
// native tooltip plus an aria-label, and the headline value next to the
// chart is real text. Theme-awareness is free: the tokens re-point in dark
// mode, the SVG never hardcodes a color.

interface Point {
  date: string; // YYYY-MM-DD
  count: number;
}

export function AdminSparkline({
  points,
  label,
}: {
  points: Point[];
  label: string;
}) {
  const W = 240;
  const H = 48;
  const n = points.length;
  if (n === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.count));
  const gap = 2;
  const barW = Math.max(2, (W - gap * (n - 1)) / n);
  const r = Math.min(2, barW / 2);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-2 h-12 w-full"
      role="img"
      aria-label={`${label}, last ${n} days`}
    >
      {points.map((p, i) => {
        // Zero days still draw a 2px stub so the timeline reads as
        // continuous rather than missing.
        const h = p.count === 0 ? 2 : Math.max(3, (p.count / max) * (H - 4));
        const x = i * (barW + gap);
        const y = H - h;
        return (
          <rect
            key={p.date}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={r}
            fill="var(--color-accent)"
            opacity={p.count === 0 ? 0.25 : 0.9}
          >
            <title>{`${p.date}: ${p.count}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
