// The world Felix lives in, widened into full-page backgrounds for the
// website. Same art grammar as Biome.tsx — a Sky gradient, flat comic
// shapes, soft rounded forms — but a different job: a biome frames a fox,
// a backdrop sits behind a page of cards. So every scene keeps its middle
// band (roughly y 200–580) near-empty and pushes the interest to the top
// and bottom edges, where content rarely reaches. Light scenes stay
// paper-pale, dark scenes stay deep and quiet, so text and cards survive
// at 100% opacity on either.
//
// One 1200x800 SVG per scene with `slice` cropping, so a tall phone and a
// wide monitor both get a sensible crop of the same picture instead of a
// stretched one.
//
// Gradient ids follow the FoxLogo.tsx rule — fixed and shared, never
// generated. Two backdrops of the same scene on one page emit
// byte-identical defs, so whichever wins is correct, and useId() would
// desync on hydration.
//
// Hexes are deliberate here, same as Biome.tsx: this is artwork in the
// brand's literal palette (globals.css @theme), not themed UI.

const OXFORD = "#0b0829";
const LAPIS = "#004e89";

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

function StarryNight() {
  return (
    <>
      <Sky id="backdrop-starry-night-sky" stops={[OXFORD, "#131043", "#221a4d"]} />
      <rect width="1200" height="800" fill="url(#backdrop-starry-night-sky)" />
      {/* moon: a full disc with a bite of sky, the den's trick at page scale */}
      <circle cx="960" cy="112" r="46" fill="#f7e1c6" opacity="0.85" />
      <circle cx="940" cy="98" r="40" fill="#131043" opacity="0.7" />
      <g fill="#f9dfc6">
        <circle cx="90" cy="84" r="2.5" opacity="0.8" />
        <circle cx="230" cy="150" r="2" opacity="0.6" />
        <circle cx="360" cy="60" r="2.5" opacity="0.75" />
        <circle cx="500" cy="126" r="2" opacity="0.55" />
        <circle cx="640" cy="70" r="2.5" opacity="0.7" />
        <circle cx="790" cy="168" r="2" opacity="0.5" />
        <circle cx="1110" cy="70" r="2.5" opacity="0.7" />
        <circle cx="1160" cy="190" r="2" opacity="0.55" />
        {/* two faint strays lower down, so the sky doesn't end in a hard line */}
        <circle cx="60" cy="310" r="1.8" opacity="0.3" />
        <circle cx="1150" cy="330" r="1.8" opacity="0.3" />
      </g>
      {/* treeline: a rolling silhouette with a few pines poking above it */}
      <g fill="#0e0b33">
        <path d="M60 720 L120 596 L180 720 Z" />
        <path d="M200 730 L250 632 L300 730 Z" />
        <path d="M880 726 L936 612 L992 726 Z" />
        <path d="M1010 734 L1056 644 L1102 734 Z" />
        <path d="M1120 730 L1164 650 L1200 730 Z" />
      </g>
      <path
        d="M0 800 L0 712 C220 692 480 704 720 696 C920 690 1080 702 1200 694 L1200 800 Z"
        fill="#080620"
      />
    </>
  );
}

function Woodsy() {
  return (
    <>
      <Sky id="backdrop-woodsy-sky" stops={["#a9c2cf", "#dae6e3", "#f3efe2"]} />
      <rect width="1200" height="800" fill="url(#backdrop-woodsy-sky)" />
      {/* two canopies leaning in at the top corners, hazed almost to sky */}
      <g fill="#4f7a41" opacity="0.3">
        <ellipse cx="40" cy="30" rx="180" ry="90" />
        <ellipse cx="1170" cy="10" rx="200" ry="100" />
      </g>
      {/* the far ridge, then haze, then the woods — depth from three values */}
      <path
        d="M0 800 L0 668 C240 648 520 662 760 654 C960 648 1100 660 1200 652 L1200 800 Z"
        fill="#9db8a8"
        opacity="0.7"
      />
      <rect y="640" width="1200" height="40" fill="#ffffff" opacity="0.4" />
      {/* oaks: round soft canopies, no trunks — trunks at this size read as posts */}
      <g fill="#5f8f4e" opacity="0.85">
        <ellipse cx="320" cy="700" rx="70" ry="46" />
        <ellipse cx="420" cy="716" rx="52" ry="36" />
        <ellipse cx="760" cy="708" rx="64" ry="42" />
        <ellipse cx="860" cy="722" rx="48" ry="32" />
      </g>
      <rect y="700" width="1200" height="30" fill="#ffffff" opacity="0.3" />
      {/* pines hold the edges so the bottom center stays walkable */}
      <g fill="#1f3d34">
        <path d="M20 800 L84 616 L148 800 Z" />
        <path d="M130 800 L184 668 L238 800 Z" />
        <path d="M980 800 L1036 660 L1092 800 Z" />
        <path d="M1080 800 L1148 608 L1200 776 Z" />
      </g>
      <path
        d="M0 800 L0 762 C300 748 900 748 1200 762 L1200 800 Z"
        fill="#31503f"
      />
    </>
  );
}

function Beachy() {
  return (
    <>
      <Sky id="backdrop-beachy-sky" stops={["#a6d3ea", "#dceef7", "#f7ecd9"]} />
      <rect width="1200" height="800" fill="url(#backdrop-beachy-sky)" />
      {/* gulls: the two-arc shorthand, nothing more or they become bats */}
      <g stroke="#5b7f96" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.6">
        <path d="M300 110 q16 -14 32 0 q16 -14 32 0" />
        <path d="M840 76 q14 -12 28 0 q14 -12 28 0" />
        <path d="M960 150 q11 -10 22 0 q11 -10 22 0" />
      </g>
      {/* the sea: two flat bands, darker further out, a foam line between */}
      <rect y="596" width="1200" height="72" fill="#6fa3c4" />
      <rect y="596" width="1200" height="34" fill="#5b8fb2" />
      <path d="M0 668 C300 662 900 662 1200 668" stroke="#ffffff" strokeWidth="4" opacity="0.6" fill="none" />
      {/* sand, warm and rising toward the viewer */}
      <path
        d="M0 800 L0 686 C260 668 560 682 800 674 C980 668 1100 678 1200 672 L1200 800 Z"
        fill="#f7c59f"
      />
      <path
        d="M0 800 L0 742 C320 726 880 726 1200 742 L1200 800 Z"
        fill="#f9dfc6"
      />
      {/* one umbrella, planted off-center left — brand orange, leaning like it means it */}
      <ellipse cx="252" cy="782" rx="66" ry="10" fill="#e08a4e" opacity="0.35" />
      <path d="M244 700 L234 784" stroke="#c96f3f" strokeWidth="7" strokeLinecap="round" />
      <path d="M162 712 Q240 626 322 704 C296 692 268 692 242 700 C216 694 188 700 162 712 Z" fill="#ff6b35" />
      <path d="M162 712 Q200 664 242 656 C222 668 200 688 190 706 Z" fill="#f7e1c6" opacity="0.85" />
    </>
  );
}

function Mountainy() {
  return (
    <>
      <Sky id="backdrop-mountainy-sky" stops={["#93aec4", "#c6d8e4", "#f1e7d6"]} />
      <rect width="1200" height="800" fill="url(#backdrop-mountainy-sky)" />
      {/* The sun goes down first, so the back range can cross it. Low behind
          rock is what makes it read as early, not as a ball in the sky. */}
      <circle cx="880" cy="540" r="72" fill="#ffd166" opacity="0.25" />
      <circle cx="880" cy="540" r="42" fill="#ffd166" opacity="0.8" />
      {/* three ranks of peaks, back to front, each a value deeper */}
      <path
        d="M0 800 L0 640 L170 528 L330 660 L480 552 L640 676 L820 540 L980 664 L1110 576 L1200 648 L1200 800 Z"
        fill="#8fa0d8"
        opacity="0.8"
      />
      <path
        d="M0 800 L0 700 L220 584 L420 712 L610 596 L810 724 L1000 604 L1200 716 L1200 800 Z"
        fill="#54718f"
      />
      <g fill="#ffffff" opacity="0.9">
        <path d="M196 598 L220 584 L246 600 C230 592 212 592 196 598 Z" />
        <path d="M586 610 L610 596 L636 612 C620 604 602 604 586 610 Z" />
        <path d="M976 618 L1000 604 L1026 620 C1010 612 992 612 976 618 Z" />
      </g>
      <path
        d="M0 800 L0 748 L260 668 L520 764 L780 676 L1040 768 L1200 700 L1200 800 Z"
        fill="#33526b"
      />
    </>
  );
}

function Grassy() {
  return (
    <>
      <Sky id="backdrop-grassy-sky" stops={["#bfe4f5", "#e3f2fa", "#f8f6ea"]} />
      <rect width="1200" height="800" fill="url(#backdrop-grassy-sky)" />
      {/* soft clouds, no outline — an outlined cloud reads as a sheep */}
      <g fill="#ffffff" opacity="0.65">
        <ellipse cx="240" cy="110" rx="90" ry="34" />
        <ellipse cx="300" cy="88" rx="58" ry="28" />
        <ellipse cx="900" cy="70" rx="72" ry="26" />
        <ellipse cx="1120" cy="150" rx="56" ry="22" />
      </g>
      {/* meadow: three rolls of hill, each nearer and deeper green */}
      <path
        d="M0 800 L0 660 C240 616 520 648 780 624 C980 606 1120 636 1200 620 L1200 800 Z"
        fill="#a8c686"
      />
      <path
        d="M0 800 L0 706 C280 672 620 700 880 676 C1040 662 1140 684 1200 672 L1200 800 Z"
        fill="#7fb069"
      />
      <path
        d="M0 800 L0 764 C320 736 880 740 1200 762 L1200 800 Z"
        fill="#5f8f4e"
      />
      {/* flowers as dots, drifting with the hills rather than gridded on them */}
      <g fill="#ffffff" opacity="0.85">
        <circle cx="160" cy="700" r="5" />
        <circle cx="420" cy="730" r="4" />
        <circle cx="980" cy="712" r="5" />
      </g>
      <g fill="#ffd166" opacity="0.9">
        <circle cx="280" cy="668" r="4" />
        <circle cx="700" cy="702" r="5" />
        <circle cx="1120" cy="690" r="4" />
      </g>
      <g fill="#f7c59f" opacity="0.9">
        <circle cx="540" cy="676" r="4" />
        <circle cx="860" cy="736" r="4" />
      </g>
    </>
  );
}

function Sunsety() {
  return (
    <>
      <Sky id="backdrop-sunsety-sky" stops={["#3b1c53", "#c1524a", "#f4a261"]} />
      <rect width="1200" height="800" fill="url(#backdrop-sunsety-sky)" />
      {/* thin bands of late light, low enough to stay out of the content's way */}
      <rect y="470" width="1200" height="22" fill="#f4a261" opacity="0.25" />
      <rect y="530" width="1200" height="14" fill="#ffd166" opacity="0.18" />
      <g stroke="#3b1c53" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.5">
        <path d="M210 130 q13 -11 26 0 q13 -11 26 0" />
        <path d="M960 90 q11 -10 22 0 q11 -10 22 0" />
      </g>
      {/* the sun on the horizon, glow first so the hills can bite into it */}
      <circle cx="620" cy="656" r="96" fill="#ffd166" opacity="0.3" />
      <circle cx="620" cy="656" r="54" fill="#ffd166" opacity="0.9" />
      {/* silhouette hills, two ranks, the front almost night already */}
      <path
        d="M0 800 L0 664 C260 632 540 664 800 640 C1000 622 1120 652 1200 640 L1200 800 Z"
        fill="#3b1c53"
      />
      <path
        d="M0 800 L0 732 C320 700 860 708 1200 736 L1200 800 Z"
        fill="#2a1440"
      />
    </>
  );
}

function Urbany() {
  return (
    <>
      <Sky id="backdrop-urbany-sky" stops={["#221a4d", "#3d2b63", "#7d4f6d"]} />
      <rect width="1200" height="800" fill="url(#backdrop-urbany-sky)" />
      <g fill="#f9dfc6">
        <circle cx="150" cy="90" r="2.5" opacity="0.6" />
        <circle cx="450" cy="60" r="2" opacity="0.45" />
        <circle cx="760" cy="110" r="2.5" opacity="0.55" />
        <circle cx="1080" cy="70" r="2" opacity="0.5" />
      </g>
      {/* Skyline: two ranks, the far one flatter and dimmer, same recipe as
          the rooftop biome — depth without needing more than a dozen boxes. */}
      <g fill="#181240" opacity="0.85">
        <rect x="0" y="600" width="150" height="200" />
        <rect x="170" y="560" width="120" height="240" />
        <rect x="560" y="620" width="130" height="180" />
        <rect x="900" y="576" width="120" height="224" />
        <rect x="1060" y="608" width="140" height="192" />
      </g>
      <g fill="#120e33">
        <rect x="60" y="650" width="170" height="150" />
        <rect x="280" y="612" width="150" height="188" />
        <rect x="700" y="640" width="160" height="160" />
        <rect x="990" y="600" width="150" height="200" />
      </g>
      {/* lit windows: someone is always up */}
      <g fill="#ffd166" opacity="0.75">
        <rect x="90" y="668" width="10" height="14" />
        <rect x="140" y="700" width="10" height="14" />
        <rect x="90" y="736" width="10" height="14" />
        <rect x="310" y="630" width="10" height="14" />
        <rect x="370" y="662" width="10" height="14" />
        <rect x="310" y="712" width="10" height="14" />
        <rect x="730" y="660" width="10" height="14" />
        <rect x="790" y="694" width="10" height="14" />
        <rect x="1020" y="620" width="10" height="14" />
        <rect x="1080" y="656" width="10" height="14" />
        <rect x="1020" y="708" width="10" height="14" />
      </g>
      <rect y="780" width="1200" height="20" fill="#0d0a28" />
    </>
  );
}

function Suburbany() {
  return (
    <>
      <Sky id="backdrop-suburbany-sky" stops={["#b7d3e8", "#dbe9f4", "#fdf6ee"]} />
      <rect width="1200" height="800" fill="url(#backdrop-suburbany-sky)" />
      {/* lawns first, then the street — the row of houses sits between them */}
      <path
        d="M0 800 L0 712 C300 700 900 700 1200 712 L1200 800 Z"
        fill="#8cab7c"
      />
      <rect y="772" width="1200" height="28" fill="#5c6b80" />
      {/* four houses, no two the same color, roofs a shade past their walls */}
      <rect x="120" y="640" width="130" height="90" fill="#f9dfc6" />
      <path d="M104 640 L185 588 L266 640 Z" fill="#c96f3f" />
      <rect x="330" y="652" width="120" height="78" fill="#f7c59f" />
      <path d="M316 652 L390 604 L464 652 Z" fill="#a85b38" />
      <rect x="740" y="646" width="126" height="84" fill="#dbe4f2" />
      <path d="M724 646 L803 596 L882 646 Z" fill={LAPIS} />
      <rect x="960" y="656" width="114" height="74" fill="#f7e1c6" />
      <path d="M946 656 L1017 610 L1088 656 Z" fill="#c96f3f" />
      <g fill="#ffd166" opacity="0.85">
        <rect x="170" y="672" width="16" height="20" />
        <rect x="786" y="676" width="16" height="20" />
      </g>
      {/* trees between the houses, round and simple */}
      <g>
        <rect x="546" y="668" width="12" height="56" fill="#7a5236" />
        <circle cx="552" cy="640" r="46" fill="#5f8f4e" />
        <rect x="1136" y="676" width="10" height="48" fill="#7a5236" />
        <circle cx="1141" cy="652" r="36" fill="#7fb069" />
      </g>
      {/* one street lamp, already on — it's that kind of evening */}
      <path d="M660 764 L660 636 Q660 620 676 620" stroke="#33415c" strokeWidth="7" fill="none" strokeLinecap="round" />
      <circle cx="684" cy="622" r="26" fill="#ffd166" opacity="0.25" />
      <circle cx="684" cy="622" r="9" fill="#ffd166" />
    </>
  );
}

function Villagy() {
  return (
    <>
      <Sky id="backdrop-villagy-sky" stops={["#cfd9ea", "#e9e9e3", "#f7ecd9"]} />
      <rect width="1200" height="800" fill="url(#backdrop-villagy-sky)" />
      {/* the hill the village leans against, cresting off to the right */}
      <path
        d="M0 800 L0 676 C300 632 640 656 900 612 C1040 588 1140 604 1200 596 L1200 800 Z"
        fill="#9bb98a"
      />
      {/* smoke before the cottages, so the curl rises from behind the roofline */}
      <path
        d="M418 566 C410 546 426 536 416 516 C408 500 424 490 420 472"
        stroke="#ffffff"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
      {/* three cottages shoulder to shoulder — a village, not a subdivision */}
      <rect x="180" y="648" width="110" height="82" fill="#f7e1c6" />
      <path d="M166 648 L235 600 L304 648 Z" fill="#a85b38" />
      <rect x="330" y="632" width="130" height="98" fill="#f9dfc6" />
      <path d="M314 632 L395 578 L476 632 Z" fill="#c96f3f" />
      <rect x="406" y="590" width="18" height="30" fill="#a85b38" />
      <rect x="500" y="654" width="104" height="76" fill="#f7c59f" />
      <path d="M486 654 L552 610 L618 654 Z" fill="#a85b38" />
      <g fill="#ffd166" opacity="0.85">
        <rect x="222" y="676" width="14" height="18" />
        <rect x="382" y="662" width="14" height="18" />
        <rect x="540" y="680" width="14" height="18" />
      </g>
      {/* the lane out front, and the nearer grass it cuts through */}
      <path
        d="M0 800 L0 744 C320 726 860 730 1200 748 L1200 800 Z"
        fill="#7fa06b"
      />
      <path
        d="M340 800 C380 768 440 748 520 738 C450 760 410 778 396 800 Z"
        fill="#d8c9a8"
      />
    </>
  );
}

function Daylighty() {
  return (
    <>
      <Sky id="backdrop-daylighty-sky" stops={["#9fd0ee", "#cfe9f8", "#eef7fd"]} />
      <rect width="1200" height="800" fill="url(#backdrop-daylighty-sky)" />
      {/* the sun, with rays as plain strokes — comic sun, not a lens flare */}
      <circle cx="1020" cy="130" r="70" fill="#ffd166" opacity="0.3" />
      <circle cx="1020" cy="130" r="46" fill="#ffd166" />
      <g stroke="#ffd166" strokeWidth="7" strokeLinecap="round" opacity="0.8">
        <path d="M1020 30 L1020 54" />
        <path d="M1020 206 L1020 230" />
        <path d="M920 130 L944 130" />
        <path d="M1096 130 L1120 130" />
        <path d="M950 60 L967 77" />
        <path d="M1073 183 L1090 200" />
        <path d="M950 200 L967 183" />
        <path d="M1073 77 L1090 60" />
      </g>
      {/* clouds at the edges, the middle left open for the page itself */}
      <g fill="#ffffff" opacity="0.75">
        <ellipse cx="220" cy="100" rx="96" ry="34" />
        <ellipse cx="290" cy="76" rx="60" ry="28" />
        <ellipse cx="640" cy="60" rx="70" ry="24" />
        <ellipse cx="120" cy="690" rx="110" ry="30" />
        <ellipse cx="1080" cy="720" rx="96" ry="28" />
      </g>
      {/* a whisper of ground so the page has somewhere to stand */}
      <path
        d="M0 800 L0 752 C340 730 860 730 1200 752 L1200 800 Z"
        fill="#d8ecd4"
      />
    </>
  );
}

export const BACKDROP_SCENE_IDS = [
  "starry-night",
  "woodsy",
  "beachy",
  "mountainy",
  "grassy",
  "sunsety",
  "urbany",
  "suburbany",
  "villagy",
  "daylighty",
] as const;

export type BackdropSceneId = (typeof BACKDROP_SCENE_IDS)[number];

// Record<BackdropSceneId, ...>, so adding an id above without drawing the
// scene fails the build instead of shipping a blank page.
const SCENES: Record<BackdropSceneId, () => React.JSX.Element> = {
  "starry-night": StarryNight,
  woodsy: Woodsy,
  beachy: Beachy,
  mountainy: Mountainy,
  grassy: Grassy,
  sunsety: Sunsety,
  urbany: Urbany,
  suburbany: Suburbany,
  villagy: Villagy,
  daylighty: Daylighty,
};

function isBackdropSceneId(id: string): id is BackdropSceneId {
  return (BACKDROP_SCENE_IDS as readonly string[]).includes(id);
}

export type BackdropTone = "light" | "dark";

/**
 * How each scene reads under text, and how much wash it needs to stay
 * readable. Both are properties of the DRAWING, so they live here beside it
 * rather than in the shop catalog — repaint a scene and these move with it.
 *
 * `tone` picks which ink the page writes in: chalk over the night scenes,
 * near-black over the pale ones. `scrim` is a veil of that tone's own base
 * color laid over the art, and it is here because no scene is a single
 * value — Woodsy is pale sky AND near-black pines, and a paragraph scrolls
 * across both. One ink cannot clear 4.5:1 on both ends of that range, so the
 * veil closes the range until the scene's worst region clears it.
 *
 * Each number is the MINIMUM that clears AA for that scene, measured off the
 * rendered pixels rather than judged by eye (the audit is in
 * docs/BACKDROP_LEGIBILITY.md). No scene pays for another's worst case:
 * Broad daylight is already safe everywhere and is veiled by nothing at all.
 */
export const BACKDROP_TONE: Record<BackdropSceneId, BackdropTone> = {
  "starry-night": "dark",
  urbany: "dark",
  sunsety: "dark",
  woodsy: "light",
  beachy: "light",
  mountainy: "light",
  grassy: "light",
  suburbany: "light",
  villagy: "light",
  daylighty: "light",
};

export const BACKDROP_SCRIM: Record<BackdropSceneId, number> = {
  "starry-night": 0.53, // the moon, and only the moon, sets this
  urbany: 0.43, // the lit windows, not the towers — the towers are already ink
  sunsety: 0.56, // the sun sitting on the horizon; the worst offender we sell
  woodsy: 0.52, // near-black pines under a paper-pale sky: the widest range
  beachy: 0.2,
  mountainy: 0.45,
  grassy: 0.22,
  suburbany: 0.48, // the lapis roof is the darkest thing in any pale scene
  villagy: 0.34,
  daylighty: 0, // pale edge to edge; the art is left exactly as drawn
};

/** The veil color for a tone: the page's own extremes, not a gray. */
export const BACKDROP_SCRIM_COLOR: Record<BackdropTone, string> = {
  light: "#ffffff",
  dark: "#0b0829", // Bleu Oxford, the palette's darkest
};

export function backdropTone(id: string): BackdropTone | null {
  return isBackdropSceneId(id) ? BACKDROP_TONE[id] : null;
}

/**
 * A full-page scene for the website to sit on. Unknown ids render nothing:
 * unlike a biome (where blank means broken), a page without a backdrop is
 * just a page, so falling back to some default scene would repaint the
 * whole site over a typo.
 *
 * Absolutely position it behind the content and let `slice` do the
 * cropping — the drawing is 1200x800, but every viewport gets a full bleed.
 *
 * The legibility veil is drawn as the last rect INSIDE the svg rather than
 * as an overlay div, so it crops with the art and no caller has to learn a
 * new layout. It is on by default everywhere, the shop preview included:
 * the thumbnail is the promise, and someone spending 220 coins should be
 * looking at the thing they will actually get.
 */
export function BackdropScene({
  id,
  className,
  scrim = true,
}: {
  id: string;
  className?: string;
  /** Off only where the raw art is the subject, never behind text. */
  scrim?: boolean;
}) {
  if (!isBackdropSceneId(id)) return null;
  const Scene = SCENES[id];
  const veil = scrim ? BACKDROP_SCRIM[id] : 0;
  return (
    <svg
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
    >
      <Scene />
      {veil > 0 && (
        <rect
          width="1200"
          height="800"
          fill={BACKDROP_SCRIM_COLOR[BACKDROP_TONE[id]]}
          opacity={veil}
        />
      )}
    </svg>
  );
}
