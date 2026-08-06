// Spoken-language screening for the analyze pipeline: find swearing in the
// transcript, mask it before anything renders it, and hand the analyze route a
// single verdict it can turn into a strike.
//
// Two rules shape everything here:
//
//   1. MASK, NEVER EDIT. The report's whole promise is that the transcript is
//      the speaker's real words (see buildSegments in /api/analyze). Masking
//      keeps that promise — "s###" is still the word they said, with the
//      letters withheld — where deleting or bleeping it would be the pipeline
//      rewriting the take. The masked text is what the model sees too, so a
//      coaching note can never quote the slur back at them.
//   2. ONE VERDICT PER RECORDING. Ten f-bombs in one minute is one lapse, not
//      ten strikes. The route dedupes on the recording so a retried analysis
//      of the same take can't double-punish either.
//
// Matching is done on AssemblyAI's word tokens, never on a substring of the
// whole transcript, so "Scunthorpe" and "assassin" can't trip it. Leetspeak
// and stretched vowels are folded in (a transcriber writes what it hears, so
// these mostly matter for the odd spelled-out take), and the handful of real
// words that collide with a stem are allowlisted.
//
// The lists were checked by running classifyWord over all 236k words of
// /usr/share/dict/words and reading every hit. Worth repeating after any edit
// here — that sweep is what caught an early version flagging every word in
// English beginning "con", plus "swanky", "spice", "heel" and "niggardly".

/** How bad the worst thing in the recording was. */
export type ProfanityTier = "mild" | "profanity" | "slur";

/**
 * Tier → strike severity, the one knob worth turning here. Zero means masked
 * but never punished.
 *
 * `mild` is 0. "Damn", "hell", "crap", "piss" — words that turn up inside
 * perfectly honest speeches ("war is hell", "a damn good year"). They are
 * still hashed out and the speaker is still told off for them; what they don't
 * do is cost a strike, because striking someone for practising a real speech
 * would make the whole system read as arbitrary, and a system read that way is
 * ignored exactly where it needs to bite. Zero severity is a judgement about
 * the penalty, NOT a statement that the word is welcome — see languageNotice,
 * where the copy has to stay firm.
 *
 * `profanity` is severity 1 (+1 strike): actual swearing. The thresholds in
 * lib/moderation.ts mean it takes three separate recordings to earn a
 * suspension and five to earn a ban. Nobody loses an account over one take.
 *
 * `slur` is severity 2 (+2), deliberately NOT 3. Severity 3 is the one-shot
 * ban, and no automated read of a speech-to-text guess should ever be able to
 * close an account on its own — a mis-transcription is a real thing, and the
 * appeal costs a real person their practice history. Two slurs still ban; an
 * operator can always go straight to severity 3 from /admin.
 */
export const TIER_SEVERITY: Record<ProfanityTier, 0 | 1 | 2> = {
  mild: 0,
  profanity: 1,
  slur: 2,
};

// Substring matches: these have no innocent use anywhere inside an English
// word, so they count wherever they appear — which is what catches the
// compounds ("bullshit", "horseshit", "clusterfuck") that a prefix match
// walks straight past. The ALLOWED list below is checked first and holds the
// handful of real words that collide once stretched letters are squeezed.
const PROFANITY_ANYWHERE = ["fuck", "shit", "cunt", "bitch", "bollock"];

// Prefix matches: anything built on these stems counts ("shitty", "twatted").
// Only stems whose prefix is unambiguous live here - "cock" and "pussy" do
// NOT, because cockpit, cocktail, cocky, cockle, pussycat and pussyfoot are
// all ordinary words; they sit in the exact list instead.
const PROFANITY_STEMS = [
  "twat",
  "slut",
  "whore",
  "wank",
  "dickhead",
  "asshole",
  "arsehole",
  "asswipe",
  "motherfuck",
  "cocksuck",
  "bastard",
];

// Exact matches: words that are a prefix of ordinary English ("ass" ->
// assassin, "cock" -> cockpit), so they only count when the whole spoken word
// is the whole swear. Plurals and the -ed/-ing forms worth having are listed
// out rather than inferred.
const PROFANITY_EXACT = [
  "ass",
  "asses",
  "arse",
  "arses",
  "dick",
  "dicks",
  "prick",
  "pricks",
  "cock",
  "cocks",
  "pussy",
  "pussies",
  "jerkoff",
];

// The mild tier: masked in the transcript, never a strike (TIER_SEVERITY.mild
// is 0). These are the words that turn up in speeches people are practising in
// good faith - "war is hell", "a damn good year", "the crap they put up with"
// - and punishing them would make the whole system feel arbitrary.
//
// Same shape as the tiers above: stems where the prefix is unambiguous, exact
// matches where it isn't ("hell" -> hello, "damn" -> damnation is fine but
// "dam" -> damage is not).
const MILD_STEMS = ["goddam", "godamn", "bugger", "dumbass", "jackass", "douche"];
const MILD_EXACT = [
  "damn",
  "damned",
  "damning",
  "damnit",
  "dammit",
  "goddamnit",
  "hell",
  "hells",
  "crap",
  "crappy",
  "crapped",
  "bullcrap",
  "piss",
  "pissed",
  "pissing",
  "pissy",
  "wtf",
  "stfu",
];

// Slurs and hate speech: the tier that escalates. This list is intentionally
// short and covers only unambiguous ethnic, racial, religious, homophobic and
// ableist slurs. Two rules keep it honest:
//
//   - A word with an ordinary English sense is NOT here, whatever else it
//     means. "Chink" (a chink in the armour) is the clearest case: at severity
//     2 a false positive costs someone two strikes for a normal idiom, and no
//     word worth catching is worth that. An operator can still strike by hand.
//   - Short ones are exact-only, because prefix matching turned "spic" into
//     spice/spicy, "fag" into fagot, "coon" into raccoon and "retard" into
//     retardant. The longer ones stay stems so inflections land.
const SLUR_STEMS = [
  "nigger",
  "nigga",
  "faggot",
  "tranny",
  "wetback",
  "raghead",
  "towelhead",
  "midget",
];
const SLUR_EXACT = [
  "fag",
  "fags",
  "dyke",
  "dykes",
  "kike",
  "kikes",
  "spic",
  "spics",
  "gook",
  "gooks",
  "coon",
  "coons",
  "paki",
  "pakis",
  "retard",
  "retards",
  "retarded",
];

/**
 * Real words that a stem would otherwise swallow. Checked against the
 * normalized token before any stem is tried.
 *
 * "shiitake" squeezes to "shitake" and would match the "shit" stem; "cocktail"
 * and "cockpit" match "cock"; "raccoon" and "cocoon" match "coon"; "flame
 * retardant" matches "retard". Anything added here is a word we would rather
 * let through than strike someone for.
 */
const ALLOWED = new Set([
  "shiitake",
  "shitake",
  "shiite",
  "cocktail",
  "cocktails",
  "cockpit",
  "cockroach",
  "cockney",
  "peacock",
  "raccoon",
  "racoon",
  "tycoon",
  "cocoon",
  "cocker",
  "retardant",
  "retardants",
  "scunthorpe",
  // "niggardly" means stingy and has no relation to the slur — but it starts
  // with the "nigga" stem, and a false slur strike is the worst mistake this
  // file could make.
  "niggard",
  "niggards",
  "niggardly",
  "niggardliness",
  "niggardness",
  "niggardize",
  "niggardling",
  // "shit" as a substring inside real words a speech might genuinely use.
  "cushite",
  "cushitic",
  "washita",
  "shittim",
  "shittimwood",
  "shittah",
]);

/**
 * Fold a spoken token down to comparable letters: drop punctuation and undo
 * the common character swaps. Stretched letters are handled separately, in
 * classifyWord — squeezing here would turn "hell" into "hel" and "coon" into
 * "con", which is how an earlier version of this file quietly flagged every
 * word in English beginning "con".
 */
function normalize(raw: string): string {
  return (
    raw
      .toLowerCase()
      // Sentence punctuation comes off the ends FIRST, because the leetspeak
      // pass below reads "!" as an "i" — without this, "Damn!" normalized to
      // "damni" and slipped past every exact match. Only the ends are trimmed,
      // and only characters that are never leetspeak at a word's start, so
      // "$hit", "sh!t" and "f*ck" all survive intact.
      .replace(/^["'“”‘’(\[{\-—…]+/, "")
      .replace(/["'“”‘’)\]}\-—…!?.,;:]+$/, "")
      .replace(/[@4]/g, "a")
      .replace(/0/g, "o")
      .replace(/[1!|]/g, "i")
      .replace(/3/g, "e")
      .replace(/[$5]/g, "s")
      .replace(/7/g, "t")
      .replace(/[^a-z]/g, "")
  );
}

/** Collapse every run of a repeated letter to one ("fuuuuck" -> "fuck"). */
function squeeze(s: string): string {
  return s.replace(/(.)\1+/g, "$1");
}

/** Drop the vowels, for matching a self-censored spelling ("f*ck" -> "fck"). */
function devowel(s: string): string {
  return s.replace(/[aeiou]/g, "");
}

const EXACT_SET = new Set(PROFANITY_EXACT);
const SLUR_EXACT_SET = new Set(SLUR_EXACT);
const MILD_EXACT_SET = new Set(MILD_EXACT);
// Fully-squeezed forms, used ONLY on the stretched-letter path below.
const EXACT_SQUEEZED = new Set(PROFANITY_EXACT.map(squeeze));
const SLUR_EXACT_SQUEEZED = new Set(SLUR_EXACT.map(squeeze));
const MILD_EXACT_SQUEEZED = new Set(MILD_EXACT.map(squeeze));
const PROFANITY_STEMS_SQUEEZED = PROFANITY_STEMS.map(squeeze);
const SLUR_STEMS_SQUEEZED = SLUR_STEMS.map(squeeze);
const MILD_STEMS_SQUEEZED = MILD_STEMS.map(squeeze);
const ANYWHERE_SQUEEZED = PROFANITY_ANYWHERE.map(squeeze);
// The self-censored forms, for the `*`/`#` path only. Mild words are left out:
// nobody stars out "damn", and a skeleton that loose would be all false
// positives for a tier that costs nothing anyway.
const CENSORED_SKELETONS = [
  ...PROFANITY_ANYWHERE,
  ...SLUR_STEMS,
  ...SLUR_EXACT,
]
  .map(devowel)
  .filter((s) => s.length >= 2);

function startsWithAny(word: string, stems: string[]): boolean {
  return stems.some((s) => word.startsWith(s));
}

function containsAny(word: string, stems: string[]): boolean {
  return stems.some((s) => word.includes(s));
}

/**
 * Classify one spoken token. Returns null for anything clean, which is the
 * overwhelmingly common case - this runs over every word of every recording.
 *
 * Order matters: worst tier first, since the worst tier in a recording sets
 * its severity. The stretched-letter pass runs last and only for tokens
 * containing a run of three identical letters, which no English word has - so
 * the looser comparison there can never see an ordinary word.
 */
export function classifyWord(raw: string): ProfanityTier | null {
  const word = normalize(raw);
  if (word.length < 2) return null;
  if (ALLOWED.has(word)) return null;

  // Contractions collide with the short exact lists once the apostrophe is
  // stripped - "he'll" normalizes to "hell". A contraction is never one of
  // these words, so it skips the exact pass; stems and substrings are
  // unaffected ("fuckin'" still matches).
  const contraction = /['\u2019]/.test(raw);

  if (startsWithAny(word, SLUR_STEMS)) return "slur";
  if (!contraction && SLUR_EXACT_SET.has(word)) return "slur";
  if (!contraction && EXACT_SET.has(word)) return "profanity";
  if (startsWithAny(word, PROFANITY_STEMS)) return "profanity";
  if (containsAny(word, PROFANITY_ANYWHERE)) return "profanity";
  if (!contraction && MILD_EXACT_SET.has(word)) return "mild";
  if (startsWithAny(word, MILD_STEMS)) return "mild";

  // Stretched for emphasis ("fuuuuck", "shiiit", "daaamn"): squeeze both sides
  // flat and try again.
  if (/(.)\1\1/.test(word)) {
    const flat = squeeze(word);
    if (!ALLOWED.has(flat)) {
      if (startsWithAny(flat, SLUR_STEMS_SQUEEZED) || SLUR_EXACT_SQUEEZED.has(flat)) {
        return "slur";
      }
      if (
        EXACT_SQUEEZED.has(flat) ||
        startsWithAny(flat, PROFANITY_STEMS_SQUEEZED) ||
        containsAny(flat, ANYWHERE_SQUEEZED)
      ) {
        return "profanity";
      }
      if (MILD_EXACT_SQUEEZED.has(flat) || startsWithAny(flat, MILD_STEMS_SQUEEZED)) {
        return "mild";
      }
    }
  }

  // Spelled out self-censored ("f*ck", "sh#t"). The stars are gone by now, so
  // the vowel-less skeleton is all that is left to match on. Gated on the
  // token having actually carried a censoring mark.
  if (/[*#]/.test(raw)) {
    const skeleton = devowel(word);
    if (skeleton.length >= 2 && containsAny(skeleton, CENSORED_SKELETONS)) {
      return "profanity";
    }
  }
  return null;
}

/**
 * Hash out everything after the first letter, keeping the surrounding
 * punctuation and the word's length. "Fucking," → "F######,".
 *
 * Length is kept deliberately: the reader can see a word was withheld and how
 * long it was, which reads as a redaction rather than as a transcription
 * glitch, and it keeps the segment's rhythm intact on screen.
 */
export function maskWord(raw: string): string {
  const m = /^([^A-Za-z0-9]*)([A-Za-z0-9'’-]*)(.*)$/.exec(raw);
  if (!m) return raw;
  const [, lead, core, tail] = m;
  if (core.length === 0) return raw;
  return `${lead}${core[0]}${"#".repeat(Math.max(1, core.length - 1))}${tail}`;
}

export interface ProfanityScan {
  /** How many spoken words were masked, across every tier. */
  count: number;
  /** The worst tier present, or null when the take was clean. */
  worst: ProfanityTier | null;
  /** Per-tier counts, for the moderation event log. Never the words. */
  tallies: Record<ProfanityTier, number>;
}

/**
 * Screen a whole recording's word list in one pass: the verdict, plus the same
 * words with every hit masked. The caller builds its transcript segments from
 * `masked` and never touches the originals again, which is what keeps the
 * unmasked word out of the report, the saved session, and the model prompt
 * alike. A clean take (the overwhelmingly common case) gets the original array
 * back untouched.
 *
 * Every tier is masked, including `mild` - masking is about what the report
 * shows, not about punishment. What the tier decides is the severity, and
 * `mild` is worth zero.
 */
export function screenWords<T extends { text: string }>(
  words: T[]
): { scan: ProfanityScan; masked: T[] } {
  const tallies: Record<ProfanityTier, number> = { mild: 0, profanity: 0, slur: 0 };
  let count = 0;
  const masked = words.map((w) => {
    const tier = classifyWord(w.text);
    if (!tier) return w;
    tallies[tier]++;
    count++;
    return { ...w, text: maskWord(w.text) };
  });
  const worst: ProfanityTier | null =
    tallies.slur > 0
      ? "slur"
      : tallies.profanity > 0
        ? "profanity"
        : tallies.mild > 0
          ? "mild"
          : null;
  return { scan: { count, worst, tallies }, masked: count === 0 ? words : masked };
}

/**
 * What the speaker is told when a recording trips this. Short, firm, and in
 * the app's voice: say what happened, say what it costs, don't lecture.
 *
 * NOTHING HERE MAY READ AS PERMISSION. The mild tier costs no strike, and the
 * speaker is entitled to know that much — but "no strike" is not "that's
 * fine". An earlier draft said "these ones are mild", which told someone
 * swearing into a speaking app that the app was relaxed about it. It isn't.
 * The mild notice is a warning about what comes next, not a pardon for what
 * just happened, and any future edit here has to keep it that way.
 */
export function languageNotice(
  scan: ProfanityScan,
  /** The state the strike landed them in, or null when no strike was applied -
   *  a mild-only take, an operator account, or a moderation write that failed.
   *  Then the notice says what was hidden and claims nothing about a record. */
  state: "ok" | "warned" | "suspended" | "banned" | null
): string {
  const masked =
    scan.count === 1
      ? "One word is hidden in your transcript."
      : `${scan.count} words are hidden in your transcript.`;
  if (scan.worst === "mild") {
    return `Keep it clean. ${masked} Anything stronger is a strike on your account.`;
  }
  const what =
    scan.worst === "slur"
      ? "Hate speech is not allowed here, ever"
      : "Swearing is not allowed here";
  if (state === null) return `${what}. ${masked}`;
  const cost =
    state === "banned"
      ? "This account has been closed."
      : state === "suspended"
        ? "Your account is suspended for 7 days."
        : "That's a strike on your account. Three suspends it, five closes it.";
  return `${what}. ${masked} ${cost}`;
}
