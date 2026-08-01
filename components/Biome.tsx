import { Felix, type FelixAccessory, type FelixMood } from "./FoxLogo";
import { DEFAULT_BIOME, isBiomeId, type BiomeId } from "@/lib/coins";

// Where Felix is standing. Bought with coins (lib/coins.ts), and drawn here.
//
// Each biome is a square SVG on the same 200x200 grid Felix uses, so the
// horizon can be placed against his feet (his body bottoms out at y=191) and
// he lands on the ground rather than in front of it. <FelixScene> stacks the
// two rather than merging them into one SVG: Felix is a finished component
// with his own moods and accessories, and reaching inside him to interleave a
// background would mean every future mood had to think about scenery.
//
// Ids follow the same rule as FoxLogo.tsx — fixed and shared, never generated.
// Two biomes of the same kind on one page emit byte-identical defs, so
// whichever wins is correct, and useId() would desync on hydration.

const DARK = "#0b0829";
const LAPIS = "#004e89";

/** The ground line, in the shared 200-unit grid. Felix's feet sit just below. */
const HORIZON = 172;

function Sky({ id, stops }: { id: string; stops: [string, string, string] }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={stops[0]} />
        <stop offset="60%" stopColor={stops[1]} />
        <stop offset="100%" stopColor={stops[2]} />
      </linearGradient>
    </defs>
  );
}

function Den() {
  return (
    <>
      <Sky id="biome-den-sky" stops={[DARK, LAPIS, "#1a659e"]} />
      <rect width="200" height="200" fill="url(#biome-den-sky)" />
      <circle cx="158" cy="42" r="16" fill="#f7e1c6" opacity="0.9" />
      <circle cx="151" cy="37" r="14" fill={LAPIS} opacity="0.6" />
      <g fill="#f9dfc6">
        <circle cx="34" cy="34" r="1.6" opacity="0.8" />
        <circle cx="64" cy="20" r="1.2" opacity="0.6" />
        <circle cx="98" cy="42" r="1.6" opacity="0.7" />
        <circle cx="122" cy="24" r="1.2" opacity="0.5" />
        <circle cx="42" cy="70" r="1.2" opacity="0.45" />
      </g>
      {/* the hill Felix's burrow is in, with the light spilling out */}
      <path
        d={`M0 200 L0 ${HORIZON - 4} C40 148 80 148 118 ${HORIZON - 10} C148 158 176 160 200 ${HORIZON} L200 200 Z`}
        fill={LAPIS}
      />
      <path
        d={`M0 200 L0 ${HORIZON - 4} C40 148 80 148 118 ${HORIZON - 10} C148 158 176 160 200 ${HORIZON} L200 200 Z`}
        fill={DARK}
        opacity="0.4"
      />
      <ellipse cx="100" cy="196" rx="62" ry="28" fill="#f7e1c6" opacity="0.16" />
      <g fill={DARK} opacity="0.55">
        <path d="M22 200 L34 158 L46 200 Z" />
        <path d="M170 200 L180 166 L190 200 Z" />
      </g>
    </>
  );
}

function Meadow() {
  return (
    <>
      <Sky id="biome-meadow-sky" stops={["#8fd3f4", "#cfeaf7", "#fbe6c2"]} />
      <rect width="200" height="200" fill="url(#biome-meadow-sky)" />
      <circle cx="156" cy="52" r="20" fill="#ffd166" opacity="0.85" />
      <circle cx="156" cy="52" r="30" fill="#ffd166" opacity="0.25" />
      {/* two soft clouds, no outline — an outlined cloud reads as a sheep */}
      <g fill="#ffffff" opacity="0.7">
        <ellipse cx="46" cy="42" rx="22" ry="10" />
        <ellipse cx="60" cy="36" rx="14" ry="9" />
        <ellipse cx="112" cy="26" rx="16" ry="7" />
      </g>
      <path
        d={`M0 200 L0 ${HORIZON + 6} C50 ${HORIZON - 8} 150 ${HORIZON - 8} 200 ${HORIZON + 6} L200 200 Z`}
        fill="#7fb069"
      />
      <path
        d={`M0 200 L0 ${HORIZON + 16} C60 ${HORIZON + 4} 140 ${HORIZON + 4} 200 ${HORIZON + 16} L200 200 Z`}
        fill="#5f8f4e"
        opacity="0.55"
      />
      {/* grass tufts, kept to the edges so they don't grow through his legs */}
      <g stroke="#4f7a41" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M14 194 C12 184 16 180 18 174" />
        <path d="M24 196 C24 188 28 184 32 180" />
        <path d="M176 194 C178 184 174 180 172 174" />
        <path d="M186 197 C186 189 182 185 178 181" />
      </g>
    </>
  );
}

function Pines() {
  return (
    <>
      <Sky id="biome-pines-sky" stops={["#54718f", "#93aec4", "#dfe9f0"]} />
      <rect width="200" height="200" fill="url(#biome-pines-sky)" />
      {/* Falling snow: static dots, not an animation. This renders behind a
          fox that may already be bouncing, and two motions at once is a snow
          globe. */}
      <g fill="#ffffff" opacity="0.75">
        <circle cx="28" cy="30" r="2" />
        <circle cx="66" cy="58" r="1.6" />
        <circle cx="104" cy="22" r="1.8" />
        <circle cx="140" cy="66" r="1.6" />
        <circle cx="172" cy="34" r="2" />
        <circle cx="46" cy="96" r="1.4" />
        <circle cx="158" cy="104" r="1.4" />
        <circle cx="88" cy="80" r="1.2" />
      </g>
      {/* the pines, dark against the pale sky, behind the snowline */}
      <g fill="#1f3d34">
        <path d="M16 176 L32 116 L48 176 Z" />
        <path d="M22 142 L32 108 L42 142 Z" />
        <path d="M56 178 L68 134 L80 178 Z" />
        <path d="M148 176 L164 118 L180 176 Z" />
        <path d="M154 144 L164 110 L174 144 Z" />
        <path d="M124 178 L134 140 L144 178 Z" />
      </g>
      {/* snow caps on the same trees */}
      <g fill="#ffffff" opacity="0.85">
        <path d="M26 128 L32 108 L38 128 C34 124 30 124 26 128 Z" />
        <path d="M158 130 L164 110 L170 130 C166 126 162 126 158 130 Z" />
      </g>
      <path
        d={`M0 200 L0 ${HORIZON + 4} C50 ${HORIZON - 10} 150 ${HORIZON - 10} 200 ${HORIZON + 4} L200 200 Z`}
        fill="#ffffff"
      />
      <path
        d={`M0 200 L0 ${HORIZON + 18} C60 ${HORIZON + 8} 140 ${HORIZON + 8} 200 ${HORIZON + 18} L200 200 Z`}
        fill="#dfe9f0"
      />
    </>
  );
}

function Rooftop() {
  return (
    <>
      <Sky id="biome-rooftop-sky" stops={["#0b0829", "#221a4d", "#3d2b63"]} />
      <rect width="200" height="200" fill="url(#biome-rooftop-sky)" />
      <g fill="#f9dfc6">
        <circle cx="24" cy="26" r="1.4" opacity="0.7" />
        <circle cx="76" cy="16" r="1.2" opacity="0.5" />
        <circle cx="128" cy="30" r="1.6" opacity="0.65" />
        <circle cx="180" cy="18" r="1.2" opacity="0.5" />
      </g>
      {/* Skyline: two ranks, the far one flatter and dimmer, so the city has
          depth without needing more than a dozen rectangles. */}
      <g fill={DARK} opacity="0.55">
        <rect x="0" y="104" width="26" height="70" />
        <rect x="30" y="88" width="20" height="86" />
        <rect x="150" y="96" width="24" height="78" />
        <rect x="178" y="82" width="22" height="92" />
      </g>
      <g fill="#120e33">
        <rect x="8" y="120" width="30" height="54" />
        <rect x="44" y="100" width="26" height="74" />
        <rect x="132" y="112" width="28" height="62" />
        <rect x="164" y="94" width="26" height="80" />
      </g>
      {/* lit windows */}
      <g fill="#ffd166" opacity="0.8">
        <rect x="14" y="128" width="4" height="6" />
        <rect x="24" y="140" width="4" height="6" />
        <rect x="14" y="152" width="4" height="6" />
        <rect x="50" y="110" width="4" height="6" />
        <rect x="60" y="124" width="4" height="6" />
        <rect x="50" y="146" width="4" height="6" />
        <rect x="140" y="122" width="4" height="6" />
        <rect x="150" y="140" width="4" height="6" />
        <rect x="170" y="104" width="4" height="6" />
        <rect x="180" y="126" width="4" height="6" />
        <rect x="170" y="148" width="4" height="6" />
      </g>
      {/* the roof he's standing on */}
      <rect x="0" y={HORIZON} width="200" height="28" fill="#2b2350" />
      <rect x="0" y={HORIZON} width="200" height="5" fill="#463a76" />
    </>
  );
}

function Dunes() {
  return (
    <>
      <Sky id="biome-dunes-sky" stops={["#3b1c53", "#c1524a", "#f4a261"]} />
      <rect width="200" height="200" fill="url(#biome-dunes-sky)" />
      <circle cx="100" cy="128" r="34" fill="#ffd166" opacity="0.55" />
      <circle cx="100" cy="128" r="22" fill="#ffe3a3" opacity="0.9" />
      {/* Dune ridges, back to front, each a shade darker. The sun sits low
          enough that the back ridge crosses it, which is what makes it read
          as setting rather than as a ball in the sky. */}
      <path
        d="M0 148 C40 132 70 142 100 138 C136 133 168 144 200 136 L200 200 L0 200 Z"
        fill="#c96f3f"
      />
      <path
        d={`M0 ${HORIZON - 8} C46 ${HORIZON - 26} 84 ${HORIZON - 4} 124 ${HORIZON - 12} C156 ${HORIZON - 18} 180 ${HORIZON - 6} 200 ${HORIZON - 14} L200 200 L0 200 Z`}
        fill="#e08a4e"
      />
      <path
        d={`M0 200 L0 ${HORIZON + 8} C56 ${HORIZON - 6} 144 ${HORIZON - 6} 200 ${HORIZON + 8} L200 200 Z`}
        fill="#f0a868"
      />
      {/* wind lines on the near dune */}
      <g stroke="#c96f3f" strokeWidth="1.6" opacity="0.5" fill="none">
        <path d="M12 190 C36 184 60 184 84 188" />
        <path d="M116 192 C140 187 164 187 188 191" />
      </g>
    </>
  );
}

// Record<BiomeId, ...>, so adding a biome to lib/coins.ts without drawing it
// here fails the build instead of shipping an empty square.
const SCENES: Record<BiomeId, () => React.JSX.Element> = {
  den: Den,
  meadow: Meadow,
  pines: Pines,
  rooftop: Rooftop,
  dunes: Dunes,
};

/**
 * A biome on its own, for the shop's preview tiles. Square; give it a size.
 *
 * Unknown ids fall back to the den rather than rendering nothing, so a stale
 * `equippedBiome` left in Firestore by a removed item shows Felix at home
 * instead of on a blank square.
 */
export function Biome({
  id,
  className = "",
}: {
  id: string | null | undefined;
  className?: string;
}) {
  const Scene = SCENES[isBiomeId(id) ? id : (DEFAULT_BIOME as BiomeId)];
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <Scene />
    </svg>
  );
}

/**
 * Felix, standing in a biome. The pair the dashboard and the shop both want.
 *
 * `overflow-hidden` on the wrapper rather than a clip path in the SVG: the
 * caller controls the corner radius through className, and a rounded biome
 * with square corners on the frame around it looks broken at every size.
 */
export function FelixScene({
  biome,
  mood = "idle",
  accessory,
  animate = false,
  className = "",
}: {
  biome: string | null | undefined;
  mood?: FelixMood;
  accessory?: FelixAccessory | null;
  animate?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`.trim()}>
      <Biome id={biome} className="absolute inset-0 h-full w-full" />
      <Felix
        className="relative h-full w-full"
        mood={mood}
        accessory={accessory}
        animate={animate}
      />
    </div>
  );
}
