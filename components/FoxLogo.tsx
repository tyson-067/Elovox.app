// Felix, the Elovox coach: the fox from the app icon, drawn as a character
// with moods so he can react to what the user is doing rather than sitting
// there as a static decal.
//
// Relationship to the brand assets:
//   /logo.png    the real app icon. Untouched, still what the header uses.
//   <FelixMark>  the icon's motif redrawn as inline SVG (head + the voice
//                bars over the chest) for places that need it to scale,
//                inherit colour, or animate.
//   <Felix>      the whole character: head, body, tail, and a mood.
//   <FoxDen>     Felix at home, for the landing page's story beats.
//
// Everything here is aria-hidden. Felix is illustration; any meaning he
// carries is stated in the text beside him.

const FUR_LIGHT = "#ff8400"; // Orange
const FUR = "#ff6b35"; // Bright Orange
const DARK = "#0b0829"; // Bleu Oxford
const LAPIS = "#004e89";
const CREAM = "#fffaf4";

/**
 * How Felix is feeling. Drives the eyes, the accessories, and whether the
 * voice bars over his chest are animated.
 *
 *   idle       eyes open, resting. The default.
 *   cheer      eyes squeezed happy, ears up. For streaks and new bests.
 *   listening  eyes closed, voice bars alive. While a recording is analysed.
 *   coach      the professor's glasses. For feedback and instruction.
 *   sleepy     eyes shut, ears down. For a broken streak or an empty state.
 */
export type FelixMood = "idle" | "cheer" | "listening" | "coach" | "sleepy";

// Fixed gradient ids, deliberately shared rather than made unique per
// instance. Several Felixes on one page will each emit a <defs> under the
// same id, and the first one in document order wins for everybody — which is
// exactly right here, because every definition is byte-identical. Generating
// unique ids instead would mean a counter or useId(), and this component
// renders in server components where a counter desyncs from the client's on
// hydration and swaps the ids out from under the fills.
const FUR_ID = "felix-fur";
const SKY_ID = "felix-den-sky";
const GLOW_ID = "felix-den-glow";

const FUR_FILL = `url(#${FUR_ID})`;

function FurGradient() {
  return (
    <defs>
      <linearGradient id={FUR_ID} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={FUR_LIGHT} />
        <stop offset="100%" stopColor={FUR} />
      </linearGradient>
    </defs>
  );
}

/** Eyes, per mood. Drawn at the same two centres either way. */
function Eyes({ mood }: { mood: FelixMood }) {
  const closed = mood === "cheer" || mood === "listening" || mood === "sleepy";
  if (closed) {
    // Happy arcs curve up; a sleepy one curves down. Same stroke either way.
    const path =
      mood === "sleepy"
        ? ["M68 88 Q78 96 88 88", "M112 88 Q122 96 132 88"]
        : ["M68 92 Q78 82 88 92", "M112 92 Q122 82 132 92"];
    return (
      <g
        stroke={DARK}
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
      >
        <path d={path[0]} />
        <path d={path[1]} />
      </g>
    );
  }
  return (
    <g>
      <ellipse cx="78" cy="88" rx="6" ry="7" fill={DARK} />
      <ellipse cx="122" cy="88" rx="6" ry="7" fill={DARK} />
      {/* catchlights, the difference between alive and taxidermy */}
      <circle cx="80.5" cy="85" r="2" fill="#ffffff" opacity="0.9" />
      <circle cx="124.5" cy="85" r="2" fill="#ffffff" opacity="0.9" />
    </g>
  );
}

/**
 * What Felix is wearing. Ids match the wardrobe in lib/quests.ts, and the
 * dashboard passes whichever one the user's level has unlocked — so an
 * unlocked outfit is a thing you can see on him, not a line in a list.
 *
 * The chest pieces (bow tie, scarf) sit where the voice bars go, so wearing
 * one hides them. The bars are decoration rather than information, and a
 * scarf drawn over five blue rectangles looks like a printing error.
 */
export type FelixAccessory =
  | "bow-tie"
  | "glasses"
  | "scarf"
  | "headset"
  | "laurels"
  | "crown";

const CHEST_ACCESSORIES: FelixAccessory[] = ["bow-tie", "scarf"];

function Accessory({ id }: { id: FelixAccessory }) {
  switch (id) {
    // Everything here sits below y=141: that's where the muzzle ends, and
    // the head is drawn over the chest, so anything higher is quietly
    // swallowed by the chin.
    case "bow-tie":
      return (
        <g fill={LAPIS}>
          <path d="M96 152 L72 141 L72 163 Z" />
          <path d="M104 152 L128 141 L128 163 Z" />
          <rect x="93" y="146" width="14" height="13" rx="4" />
        </g>
      );
    case "glasses":
      return <Glasses />;
    case "scarf":
      return (
        <g>
          <path
            d="M70 136 C82 148 118 148 130 136 L131 158 C118 168 82 168 69 158 Z"
            fill={LAPIS}
          />
          <path
            d="M118 162 C129 168 137 176 135 190 L118 189 C120 178 118 170 112 164 Z"
            fill={LAPIS}
          />
          <g stroke="#ffffff" strokeWidth="2.5" opacity="0.28">
            <path d="M80 144 L80 164" />
            <path d="M94 147 L94 167" />
            <path d="M110 147 L110 167" />
          </g>
        </g>
      );
    case "headset":
      return (
        <g>
          <path
            d="M40 92 C40 46 160 46 160 92"
            stroke={DARK}
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />
          <rect x="30" y="80" width="20" height="30" rx="9" fill={DARK} />
          <rect x="150" y="80" width="20" height="30" rx="9" fill={DARK} />
          <path
            d="M154 108 C150 128 136 136 122 138"
            stroke={DARK}
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="120" cy="138" r="6" fill={FUR_LIGHT} stroke={DARK} strokeWidth="2.5" />
        </g>
      );
    case "laurels":
      return (
        // Lapis, not the gold you'd expect on a wreath: Amande on orange fur
        // is two warm tones a shade apart and the whole thing disappeared.
        <g stroke={LAPIS} strokeWidth="6" fill="none" strokeLinecap="round">
          <path d="M52 128 C34 106 38 76 58 58" />
          <path d="M148 128 C166 106 162 76 142 58" />
          <g strokeWidth="4" opacity="0.9">
            <path d="M44 112 L34 106" />
            <path d="M42 96 L31 92" />
            <path d="M45 80 L35 74" />
            <path d="M156 112 L166 106" />
            <path d="M158 96 L169 92" />
            <path d="M155 80 L165 74" />
          </g>
        </g>
      );
    case "crown":
      return (
        <g>
          <path
            d="M72 58 L72 34 L86 46 L100 30 L114 46 L128 34 L128 58 Z"
            fill="#ff8400"
            stroke={DARK}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle cx="100" cy="49" r="4" fill={LAPIS} />
        </g>
      );
  }
}

/** The professor's round glasses, from the original Felix. Coach mood only. */
function Glasses() {
  return (
    <g stroke={LAPIS} strokeWidth="4" fill="rgba(255,255,255,0.35)">
      <circle cx="78" cy="88" r="17" />
      <circle cx="122" cy="88" r="17" />
      <path d="M95 86 Q100 81 105 86" fill="none" strokeLinecap="round" />
      <path d="M61 84 L48 78" strokeLinecap="round" />
      <path d="M139 84 L152 78" strokeLinecap="round" />
    </g>
  );
}

/**
 * The five voice bars from the app icon, sitting over the white chest.
 * `alive` runs them as a level meter; otherwise they hold a static shape.
 */
function VoiceBars({ alive = false }: { alive?: boolean }) {
  const bars = [14, 26, 38, 26, 14];
  return (
    <g fill={LAPIS}>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={82 + i * 9}
          y={154 - h / 2}
          width="6"
          height={h}
          rx="3"
          // The animation itself lives in globals.css so the reduced-motion
          // query can switch it off; only the per-bar offset is inline, and
          // an animation-delay on a cancelled animation is inert.
          className={alive ? "felix-bar" : undefined}
          style={
            alive
              ? {
                  transformOrigin: `${85 + i * 9}px 154px`,
                  animationDelay: `${i * 110}ms`,
                }
              : undefined
          }
        />
      ))}
    </g>
  );
}

/**
 * The whole fox. Square, so `h-40 w-40` and friends work without distortion.
 *
 * `animate` adds the idle sway (or the cheer bounce on a cheering Felix).
 * Off by default: a page with several Felixes all bobbing is a fairground.
 */
export function Felix({
  className = "",
  mood = "idle",
  animate = false,
  accessory,
}: {
  className?: string;
  mood?: FelixMood;
  animate?: boolean;
  accessory?: FelixAccessory | null;
}) {
  const fur = FUR_FILL;
  const wearingChestPiece = !!accessory && CHEST_ACCESSORIES.includes(accessory);
  // The glasses are both a mood and an unlockable. Drawing them twice is
  // just two identical circles on top of each other, so whichever asked
  // first wins and the other stands down.
  const showGlasses = mood === "coach" || accessory === "glasses";
  const motion = animate
    ? mood === "cheer"
      ? "felix-cheer"
      : "felix-idle"
    : "";

  return (
    <svg
      viewBox="0 0 200 200"
      className={`${className} ${motion}`.trim()}
      aria-hidden="true"
    >
      <FurGradient />

      {/* tail, sweeping out behind him with the white tip */}
      <path
        d="M134 172 C176 176 196 142 185 112 C178 94 160 89 151 102 C167 111 168 137 149 148 C141 153 136 162 134 172 Z"
        fill={fur}
      />
      <path
        d="M185 112 C178 94 160 89 151 102 C159 107 164 115 165 124 C174 125 182 120 185 112 Z"
        fill={CREAM}
      />

      {/* body */}
      <path
        d="M100 106 C133 106 153 133 153 162 C153 181 140 191 100 191 C60 191 47 181 47 162 C47 133 67 106 100 106 Z"
        fill={fur}
      />
      {/* chest blaze */}
      <path
        d="M100 120 C117 120 127 142 127 161 C127 178 116 184 100 184 C84 184 73 178 73 161 C73 142 83 120 100 120 Z"
        fill={CREAM}
      />
      {/* Chest pieces go here, in the voice bars' slot: in front of the
          blaze, but drawn before the head so the chin overlaps them the way
          a real collar sits. */}
      {wearingChestPiece && accessory ? (
        <Accessory id={accessory} />
      ) : (
        <VoiceBars alive={mood === "listening"} />
      )}

      {/* ears. Sleepy Felix's fold back, which is most of what sells the mood */}
      <g
        style={
          mood === "sleepy"
            ? { transform: "rotate(-8deg)", transformOrigin: "100px 76px" }
            : undefined
        }
      >
        <path d="M56 78 L49 24 L93 52 Z" fill={fur} />
        <path d="M144 78 L151 24 L107 52 Z" fill={fur} />
        <path d="M63 69 L58 37 L83 54 Z" fill={DARK} opacity="0.2" />
        <path d="M137 69 L142 37 L117 54 Z" fill={DARK} opacity="0.2" />
      </g>

      {/* head */}
      <path
        d="M47 72 C64 44 136 44 153 72 C160 101 143 126 118 136 C106 141 94 141 82 136 C57 126 40 101 47 72 Z"
        fill={fur}
      />
      {/* muzzle */}
      <path
        d="M73 106 C83 126 117 126 127 106 C125 128 114 139 100 141 C86 139 75 128 73 106 Z"
        fill={CREAM}
      />
      <ellipse cx="100" cy="113" rx="6.5" ry="5.5" fill={DARK} />

      {showGlasses ? <Glasses /> : null}
      <Eyes mood={mood} />

      {/* whiskers, barely there */}
      <g stroke={DARK} strokeWidth="1.6" strokeLinecap="round" opacity="0.25">
        <path d="M70 112 L52 108" />
        <path d="M70 117 L53 118" />
        <path d="M130 112 L148 108" />
        <path d="M130 117 L147 118" />
      </g>

      {/* Head pieces last, so a crown or a headset sits over the ears. */}
      {accessory && !wearingChestPiece && accessory !== "glasses" ? (
        <Accessory id={accessory} />
      ) : null}
    </svg>
  );
}

/**
 * Head and voice bars only, the app-icon motif. For tight spots: inline
 * beside a heading, inside a badge, as a bullet.
 */
export function FelixMark({
  className = "",
  mood = "idle",
}: {
  className?: string;
  mood?: FelixMood;
}) {
  const fur = FUR_FILL;
  return (
    <svg viewBox="30 20 140 140" className={className} aria-hidden="true">
      <FurGradient />
      <path d="M56 78 L49 24 L93 52 Z" fill={fur} />
      <path d="M144 78 L151 24 L107 52 Z" fill={fur} />
      <path d="M63 69 L58 37 L83 54 Z" fill={DARK} opacity="0.2" />
      <path d="M137 69 L142 37 L117 54 Z" fill={DARK} opacity="0.2" />
      <path
        d="M47 72 C64 44 136 44 153 72 C160 101 143 126 118 136 C106 141 94 141 82 136 C57 126 40 101 47 72 Z"
        fill={fur}
      />
      <path
        d="M73 106 C83 126 117 126 127 106 C125 128 114 139 100 141 C86 139 75 128 73 106 Z"
        fill={CREAM}
      />
      <ellipse cx="100" cy="113" rx="6.5" ry="5.5" fill={DARK} />
      <Eyes mood={mood} />
    </svg>
  );
}

/**
 * Felix at home: a burrow under a hill with the light on, him in the
 * doorway. The landing page uses it to give the mascot somewhere to be,
 * rather than floating him on a gradient panel.
 *
 * Wide (5:3), so give it a width and let the height follow.
 */
export function FoxDen({ className = "" }: { className?: string }) {
  const fur = FUR_FILL;
  return (
    <svg viewBox="0 0 500 300" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={FUR_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={FUR_LIGHT} />
          <stop offset="100%" stopColor={FUR} />
        </linearGradient>
        <linearGradient id={SKY_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b0829" />
          <stop offset="55%" stopColor="#004e89" />
          <stop offset="100%" stopColor="#1a659e" />
        </linearGradient>
        <radialGradient id={GLOW_ID} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f7e1c6" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#f7e1c6" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* dusk sky */}
      <rect width="500" height="300" fill={`url(#${SKY_ID})`} rx="12" />
      {/* moon and a handful of stars */}
      <circle cx="416" cy="58" r="26" fill="#f7e1c6" opacity="0.9" />
      <circle cx="405" cy="50" r="24" fill="#004e89" opacity="0.55" />
      <g fill="#f9dfc6">
        <circle cx="70" cy="48" r="2" opacity="0.8" />
        <circle cx="132" cy="30" r="1.6" opacity="0.6" />
        <circle cx="212" cy="60" r="2.2" opacity="0.75" />
        <circle cx="300" cy="36" r="1.6" opacity="0.5" />
        <circle cx="352" cy="86" r="2" opacity="0.7" />
        <circle cx="96" cy="104" r="1.4" opacity="0.45" />
      </g>

      {/* far hill, then the den's hill */}
      <path
        d="M0 232 C90 196 150 214 226 208 C310 202 402 176 500 208 L500 300 L0 300 Z"
        fill="#0b0829"
        opacity="0.45"
      />
      <path
        d="M0 300 L0 258 C70 214 150 222 214 244 C268 262 330 250 388 232 C430 219 468 224 500 238 L500 300 Z"
        fill="#8fa0d8"
        opacity="0.28"
      />
      {/* The chimney goes down FIRST, so the hill draws over its base and it
          reads as coming out of the roof rather than hovering in the sky. */}
      <rect x="236" y="140" width="18" height="60" rx="5" fill="#0b0829" />
      <rect x="231" y="138" width="28" height="10" rx="4" fill="#0b0829" />
      <path
        d="M245 134 C245 118 258 118 258 104 C258 92 248 92 248 82"
        stroke="#f9dfc6"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        opacity="0.4"
      />

      {/* the den's hill, solid enough to be a place */}
      <path
        d="M46 300 C46 216 108 166 186 166 C264 166 326 216 326 300 Z"
        fill="#004e89"
      />
      <path
        d="M46 300 C46 216 108 166 186 166 C264 166 326 216 326 300 Z"
        fill="#0b0829"
        opacity="0.35"
      />

      {/* the burrow mouth, lit from inside */}
      <ellipse cx="186" cy="300" rx="130" ry="104" fill={`url(#${GLOW_ID})`} opacity="0.55" />
      <path
        d="M186 206 C216 206 238 232 238 268 L238 300 L134 300 L134 268 C134 232 156 206 186 206 Z"
        fill="#0b0829"
      />
      <path
        d="M186 214 C212 214 231 237 231 268 L231 300 L141 300 L141 268 C141 237 160 214 186 214 Z"
        fill="#ff8400"
        opacity="0.28"
      />
      {/* a round window with the light on */}
      <circle cx="272" cy="228" r="15" fill="#0b0829" />
      <circle cx="272" cy="228" r="11" fill="#f7e1c6" opacity="0.85" />

      {/* Felix in the doorway, half-lit */}
      <g transform="translate(140 178) scale(0.46)">
        <path
          d="M100 106 C133 106 153 133 153 162 C153 181 140 191 100 191 C60 191 47 181 47 162 C47 133 67 106 100 106 Z"
          fill={fur}
        />
        <path
          d="M100 120 C117 120 127 142 127 161 C127 178 116 184 100 184 C84 184 73 178 73 161 C73 142 83 120 100 120 Z"
          fill={CREAM}
        />
        <path d="M56 78 L49 24 L93 52 Z" fill={fur} />
        <path d="M144 78 L151 24 L107 52 Z" fill={fur} />
        <path
          d="M47 72 C64 44 136 44 153 72 C160 101 143 126 118 136 C106 141 94 141 82 136 C57 126 40 101 47 72 Z"
          fill={fur}
        />
        <path
          d="M73 106 C83 126 117 126 127 106 C125 128 114 139 100 141 C86 139 75 128 73 106 Z"
          fill={CREAM}
        />
        <ellipse cx="100" cy="113" rx="6.5" ry="5.5" fill={DARK} />
        <g stroke={DARK} strokeWidth="5" strokeLinecap="round" fill="none">
          <path d="M68 92 Q78 82 88 92" />
          <path d="M112 92 Q122 82 132 92" />
        </g>
      </g>

      {/* a couple of pines, for scale. Kept left of x=400 so the Felix the
          landing page hangs off the bottom-right corner doesn't sit on them. */}
      <g fill="#0b0829" opacity="0.6">
        <path d="M344 300 L362 232 L380 300 Z" />
        <path d="M354 258 L362 220 L370 258 Z" />
        <path d="M390 300 L404 250 L418 300 Z" />
      </g>
    </svg>
  );
}
