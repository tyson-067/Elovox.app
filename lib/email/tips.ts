/**
 * The speaking-tips drip.
 *
 * Somebody leaves their address on the tips form and, from then on, gets one
 * tip a week until the sequence runs out. Nobody writes anything, nobody
 * presses send, and nobody has to remember it exists — which is the only kind
 * of mailing list a small team actually keeps running. The alternative, a
 * newsletter somebody means to write, is a signup form that collects addresses
 * and then goes quiet, and quiet is worse than never asking.
 *
 * WHY THE CONTENT LIVES IN CODE. A drip needs a fixed, ordered sequence, and
 * an ordered sequence in a database is a thing somebody has to administer. Here
 * it is an array: adding a tip is appending to it, and everyone already partway
 * through simply carries on into the new ones the week they reach them.
 *
 * WHAT THIS LIST MAY CONTAIN. Tips. Only tips. /privacy tells these addresses
 * their address is used "only to send those tips", and that sentence is the
 * whole contract with them — it is not a channel for product news, launches, or
 * discounts. People who want that are ACCOUNT HOLDERS, who have their own
 * `product` preference, and the two lists never merge. See the note in
 * ./audience.ts, which says the same thing where it would be easiest to forget.
 *
 * The schedule is per SUBSCRIBER, not global: everyone gets tip 1 a week after
 * they join, whenever that was. So the cron sends a handful most days rather
 * than the whole list at once, which also keeps it comfortably inside a
 * hundred-a-day plan.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Block } from "./render";
import type { AppMessage } from "./send";
import { sendBulk } from "./send";
import { siteUrl } from "./config";

/** A week between tips. Often enough to be a habit, rare enough that nobody
 *  resents it. Anything faster reads as a course nobody signed up for. */
export const TIP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Tip {
  /** Stable, and never reused — it is half of the idempotency key. */
  id: string;
  subject: string;
  heading: string;
  blocks: Block[];
}

/**
 * The sequence.
 *
 * Written to be worth opening: one idea per email, something to actually do,
 * and no throat-clearing. Short and plainly human — the same voice the app
 * uses, which users have already told us they prefer to the alternative.
 *
 * Every fourth one or so mentions Elovox, and the rest don't. A tips list that
 * advertises in every message stops being a tips list, and people can tell
 * within three emails.
 *
 * When this runs out the drip simply stops. That is a fine ending — better
 * than padding it — and appending more later picks everyone up where they got
 * to.
 */
export const TIPS: Tip[] = [
  {
    id: "filler-words",
    subject: "Find your filler word",
    heading: "Find your filler word",
    blocks: [
      { kind: "lead", text: "Everyone has one. Almost nobody knows which." },
      {
        kind: "p",
        text: "Record sixty seconds of yourself explaining what you did yesterday. Play it back and count. Most people find it on the first take, and it's rarely the one they'd have guessed.",
      },
      {
        kind: "p",
        text: "You don't have to eliminate it. Just noticing it is most of the fix, because you start hearing it live.",
      },
    ],
  },
  {
    id: "the-pause",
    subject: "The pause is the technique",
    heading: "The pause is the technique",
    blocks: [
      { kind: "lead", text: "Silence feels much longer to you than to anyone listening." },
      {
        kind: "p",
        text: "A two-second pause feels enormous from the inside and reads as confidence from the outside. It's also where filler words come from: the urge to fill the gap is what produces the \"um\".",
      },
      {
        kind: "p",
        text: "Next time you lose your thread, just stop. Don't narrate it. Pick the sentence back up when you have it.",
      },
    ],
  },
  {
    id: "first-sentence",
    subject: "Know your first sentence by heart",
    heading: "Know your first sentence by heart",
    blocks: [
      { kind: "lead", text: "Not the whole thing. Just the first sentence." },
      {
        kind: "p",
        text: "The opening is where nerves are loudest, and it's the only part where having the words already decided costs you nothing in naturalness. Once you're through it you're talking, and talking is easy.",
      },
      { kind: "p", text: "Memorize one sentence. Improvise the rest." },
    ],
  },
  {
    id: "slow-down",
    subject: "You're talking faster than you think",
    heading: "You're talking faster than you think",
    blocks: [
      { kind: "lead", text: "Nerves add about 20% to your pace, and you won't feel it." },
      {
        kind: "p",
        text: "Around 140 words a minute is comfortable to listen to. Under pressure most people drift past 170, which is where an audience stops absorbing and starts just keeping up.",
      },
      {
        kind: "p",
        text: "The fix isn't \"talk slower\". That feels absurd and never survives the first minute. It's to pause at full stops. Pace looks after itself.",
      },
      { kind: "cta", label: "See your pace", href: `${siteUrl()}/practice` },
    ],
  },
  {
    id: "one-idea",
    subject: "One idea per talk",
    heading: "One idea per talk",
    blocks: [
      { kind: "lead", text: "Ask yourself what you want someone repeating tomorrow." },
      {
        kind: "p",
        text: "If the answer is three things, it'll be none. People leave with one idea at most, so the only real decision is which one, and making it deliberately beats letting the audience pick.",
      },
      {
        kind: "p",
        text: "Write your one sentence before you write anything else. Everything that doesn't support it is a candidate for cutting.",
      },
    ],
  },
  {
    id: "hands",
    subject: "What to do with your hands",
    heading: "What to do with your hands",
    blocks: [
      { kind: "lead", text: "Nothing, deliberately." },
      {
        kind: "p",
        text: "Let them hang. It feels ridiculous for about a week and looks completely normal from the first day. Gestures then arrive on their own when you mean something, which is the only time they land.",
      },
      {
        kind: "p",
        text: "What reads badly is the fidget: pockets, clicking a pen, gripping the lectern. Those are the things an audience notices.",
      },
    ],
  },
  {
    id: "read-it-aloud",
    subject: "Read it aloud before you believe it works",
    heading: "Read it aloud before you believe it works",
    blocks: [
      { kind: "lead", text: "Writing that looks fine on a page can be unsayable." },
      {
        kind: "p",
        text: "Long subordinate clauses, stacked adjectives, any sentence you have to take a breath in the middle of: you'll find all of them in about ninety seconds of reading out loud, and never by re-reading silently.",
      },
      { kind: "p", text: "If you run out of air, the sentence is too long. Cut it in two." },
    ],
  },
  {
    id: "the-question",
    subject: "Rehearse the question you're dreading",
    heading: "Rehearse the question you're dreading",
    blocks: [
      { kind: "lead", text: "You already know what it is." },
      {
        kind: "p",
        text: "There's always one: the hole in the argument, the number that's weak, the thing you hope nobody asks. Most people prepare everything except that, and then it's the only question that actually gets asked.",
      },
      {
        kind: "p",
        text: "Answer it out loud once, in advance. It's never as bad the second time you say it.",
      },
      { kind: "cta", label: "Practice a Q&A", href: `${siteUrl()}/interviews` },
    ],
  },
  {
    id: "energy",
    subject: "Bring 10% more than feels natural",
    heading: "Bring 10% more than feels natural",
    blocks: [
      { kind: "lead", text: "Energy shrinks on the way across a room." },
      {
        kind: "p",
        text: "What feels animated standing up in front of people usually reads as flat from the back row, and what feels slightly over the top reads as engaged. It's a calibration problem, not a personality one.",
      },
      {
        kind: "p",
        text: "This is the single thing that most reliably improves when you watch yourself back. Trust the recording over the feeling.",
      },
    ],
  },
  {
    id: "endings",
    subject: "Stop when you're done",
    heading: "Stop when you're done",
    blocks: [
      { kind: "lead", text: "Most talks end three times." },
      {
        kind: "p",
        text: "There's the real ending, then a summary of the ending, then a thank-you that restates it again. Each one deflates the last. Land the point and stop talking.",
      },
      {
        kind: "p",
        text: "\"Thank you\" is a perfectly good final sentence. It just has to come immediately after the point, not two minutes later.",
      },
    ],
  },
  {
    id: "nerves",
    subject: "Nerves and excitement are the same signal",
    heading: "Nerves and excitement are the same signal",
    blocks: [
      { kind: "lead", text: "Same heart rate, same hands, different label." },
      {
        kind: "p",
        text: "Trying to calm down fights your own physiology and rarely works in the ninety seconds you have. Relabeling it does work, and it's free: the sensation you're having is what caring about something feels like.",
      },
      {
        kind: "p",
        text: "The reliable part is reps. It's much harder to be nervous about something you've already done forty times alone.",
      },
      { kind: "cta", label: "Get a rep in", href: `${siteUrl()}/practice` },
    ],
  },
  {
    id: "listen-back",
    subject: "The last one: listen to yourself",
    heading: "Listen to yourself",
    blocks: [
      { kind: "lead", text: "This is the whole thing, and it's the part people skip." },
      {
        kind: "p",
        text: "Everything in these emails is findable in one recording of your own voice. Nobody enjoys the first playback. It stops being uncomfortable around the fourth, and by then you're improving faster than any amount of advice can manage.",
      },
      {
        kind: "p",
        text: "That's the last tip in this sequence, so no more scheduled emails from us. Thanks for reading them.",
      },
      { kind: "cta", label: "Record one", href: `${siteUrl()}/practice` },
    ],
  },
];

/** Build the message for one subscriber at one position in the sequence. */
export function tipMessage(email: string, index: number): AppMessage | null {
  const tip = TIPS[index];
  if (!tip) return null;
  return {
    to: email,
    category: "marketing",
    type: `tip-${tip.id}`,
    prefKey: "tips",
    prefLabel: "speaking tips list",
    // Address + tip id, so a redelivered cron cannot send the same tip twice
    // and a future tip is unaffected.
    key: `tip:${tip.id}:${email}`,
    subject: tip.subject,
    doc: {
      preheader: blurbOf(tip),
      heading: tip.heading,
      blocks: [
        ...tip.blocks,
        {
          kind: "note",
          text: `Tip ${index + 1} of ${TIPS.length}. One a week, nothing else.`,
        },
      ],
    },
  };
}

/** The inbox preview line: the tip's own first sentence, which is always the
 *  most interesting one. Better than a generic "this week's tip". */
function blurbOf(tip: Tip): string {
  const first = tip.blocks.find((b) => b.kind === "lead" || b.kind === "p");
  return first && "text" in first ? first.text : tip.heading;
}

/* --- The run --------------------------------------------------------------- */

export interface DripResult {
  candidates: number;
  sent: number;
  suppressed: number;
  overBudget: number;
  failed: number;
  /** Subscribers who have reached the end of the sequence. */
  finished: number;
}

function toMillis(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

/**
 * Send whichever tip each subscriber is due, to whoever is due one today.
 *
 * Position is tracked on the lead's own row (`tipIndex` = how many they've
 * had), and the clock is `lastTipAt`, falling back to `since` for someone who
 * has had none yet. So this reconciles against "who is due right now" rather
 * than against what happened last time — a missed day is picked up by the next
 * run, and a double run sends nothing extra.
 *
 * Progress is recorded ONLY for addresses Resend actually accepted
 * (`result.sentTo`), never for the first N of the queue. The queue gets
 * reordered by suppression filtering and trimmed by the budget, so counting
 * positionally would silently skip a tip for everyone behind a suppressed
 * subscriber.
 */
export async function runTipsDrip(
  db: Firestore | null,
  now: number = Date.now()
): Promise<DripResult> {
  const nothing: DripResult = {
    candidates: 0,
    sent: 0,
    suppressed: 0,
    overBudget: 0,
    failed: 0,
    finished: 0,
  };
  if (!db) return nothing;

  let snap;
  try {
    snap = await db.collection("leads").get();
  } catch (err) {
    console.error("[tips] couldn't read the list", err);
    return nothing;
  }

  let finished = 0;
  const due: Array<{ email: string; index: number }> = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const email = typeof data.email === "string" ? data.email : null;
    if (!email) continue;

    const index = typeof data.tipIndex === "number" ? data.tipIndex : 0;
    if (index >= TIPS.length) {
      finished++;
      continue;
    }

    // The clock: when they last heard from us, or when they joined.
    const last = toMillis(data.lastTipAt) ?? toMillis(data.since);
    // No usable timestamp at all — an old row from before `since` was stamped.
    // Treat it as due rather than stranding them forever.
    if (last != null && now - last < TIP_INTERVAL_MS) continue;

    due.push({ email, index });
  }

  if (due.length === 0) return { ...nothing, finished };

  // Furthest through the sequence first. If the day's marketing allowance runs
  // short, the people who get pushed to tomorrow are the ones who only just
  // joined and are not yet expecting anything.
  due.sort((a, b) => b.index - a.index);

  const messages = due
    .map(({ email, index }) => tipMessage(email, index))
    .filter((m): m is AppMessage => m !== null);

  const result = await sendBulk(db, "marketing", messages);

  // Advance only the confirmed sends.
  const byEmail = new Map(due.map((d) => [d.email.trim().toLowerCase(), d.index]));
  const batch = db.batch();
  let writes = 0;
  for (const address of result.sentTo) {
    const index = byEmail.get(address);
    if (index === undefined) continue;
    batch.set(
      db.doc(`leads/${encodeURIComponent(address)}`),
      { tipIndex: index + 1, lastTipAt: now, lastTipId: TIPS[index]?.id ?? null },
      { merge: true }
    );
    writes++;
  }
  if (writes > 0) {
    // A failure here would re-send the same tip tomorrow — annoying, not
    // harmful, and much better than advancing past a tip nobody received.
    await batch.commit().catch((err) => {
      console.error("[tips] couldn't record progress; tips may repeat", err);
    });
  }

  return {
    candidates: messages.length,
    sent: result.sent,
    suppressed: result.suppressed,
    overBudget: result.overBudget,
    failed: result.failed,
    finished,
  };
}
