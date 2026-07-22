// Felix, the Elovox AI coach: a front-facing fox in round professor's
// glasses and a bow tie. (The app logo itself is the real brand asset at
// /logo.png — Felix is the coach character version of that fox, drawn to
// match its palette. Logo: no glasses. Felix: glasses.)

const ORANGE = "#e8792f";
const NAVY = "#2e3a66";

export function Felix({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden="true">
      {/* ears */}
      <path d="M28 52 L33 12 L60 34 Z" fill={ORANGE} />
      <path d="M100 52 L95 12 L68 34 Z" fill={ORANGE} />
      <path d="M35 44 L38 23 L52 34 Z" fill={NAVY} opacity="0.25" />
      <path d="M93 44 L90 23 L76 34 Z" fill={NAVY} opacity="0.25" />
      {/* head */}
      <path
        d="M22 50 Q64 26 106 50 Q109 74 88 88 Q64 103 40 88 Q19 74 22 50 Z"
        fill={ORANGE}
      />
      {/* muzzle */}
      <path d="M44 76 Q64 94 84 76 Q82 94 64 100 Q46 94 44 76 Z" fill="#ffffff" />
      {/* nose */}
      <circle cx="64" cy="90" r="4.2" fill={NAVY} />
      {/* the professor's round glasses */}
      <g stroke={NAVY} strokeWidth="4" fill="rgba(255,255,255,0.45)">
        <circle cx="45" cy="60" r="13.5" />
        <circle cx="83" cy="60" r="13.5" />
      </g>
      <path d="M58.5 58 Q64 53 69.5 58" stroke={NAVY} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M31.5 58 L24 52" stroke={NAVY} strokeWidth="4" strokeLinecap="round" />
      <path d="M96.5 58 L104 52" stroke={NAVY} strokeWidth="4" strokeLinecap="round" />
      {/* eyes behind the lenses */}
      <circle cx="45" cy="61" r="3.4" fill={NAVY} />
      <circle cx="83" cy="61" r="3.4" fill={NAVY} />
      {/* bow tie */}
      <g fill={NAVY}>
        <path d="M62 110 L44 102 L44 120 Z" />
        <path d="M66 110 L84 102 L84 120 Z" />
        <rect x="59" y="105" width="10" height="10" rx="2.5" />
      </g>
    </svg>
  );
}
