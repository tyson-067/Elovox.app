import { isFirebaseConfigured, getDb, getUser } from "./firebase";

// Post-signup onboarding: a short run of quick multiple-choice questions
// answered once, before first dashboard access. Answers live in Firestore at
// users/{uid}/profile/onboarding (localStorage fallback without Firebase),
// and completion is cached in localStorage so the RequireAuth gate doesn't
// hit Firestore on every navigation. Add/remove questions freely, the
// onboarding screen renders whatever is in this list and sizes its progress
// bar to the count.

export interface OnboardingQuestion {
  id: string;
  question: string;
  hint?: string;
  multi?: boolean; // multi-select (needs an explicit Continue)
  options: string[];
}

// Seven questions, deliberately. This ran to 20 before launch, which is a lot
// of friction to put between a hard-gated signup and the first real screen.
// What survived earns its place: intent (`goal`, `skills`), a difficulty
// signal (`experience`), the one thing to work on (`challenge`), a reason to
// come back (`upcoming`, `practice_time`), and attribution (`source`).
//
// Cut, and why, so they don't creep back in one at a time:
//   age                          already collected at signup by the DOB age
//                                gate (lib/age.ts); asking twice is duplicate
//                                collection of a minor's data
//   role                         `skills` says more about what to practise
//   context, focus               overlap `skills`; three angles on one answer
//   nerves                       "Nerves" is already an option under `challenge`
//   comfort, frequency           `experience` covers where someone is
//   audience_size, voice_goal    too fine-grained to act on before there is
//                                anything that reads them
//   record_comfort               asking about dread invites it
//   accountability, commitment   asks for a promise, not information
//   feedback_style               revisit as a settings toggle, where it can be
//                                changed after someone has seen the feedback
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "goal",
    question: "What brings you to Elovox?",
    options: [
      "Beat my nerves",
      "Nail a specific event",
      "Sound more confident day to day",
      "Get promotion-ready presence",
      "Just curious",
    ],
  },
  {
    id: "skills",
    question: "What do you want to get better at?",
    hint: "Pick as many as you like",
    multi: true,
    options: [
      "Public speaking",
      "Interviews",
      "Pitches & presentations",
      "Everyday confidence",
      "Leadership presence",
    ],
  },
  {
    id: "experience",
    question: "How would you rate your speaking today?",
    options: ["Just starting out", "Getting there", "Pretty solid", "Advanced"],
  },
  {
    id: "challenge",
    question: "What trips you up most?",
    options: [
      "Nerves",
      "Filler words (um, like)",
      "Pacing, I rush",
      "A flat, monotone voice",
      "Losing my train of thought",
      "Body language",
    ],
  },
  {
    id: "upcoming",
    question: "Anything coming up you want to nail?",
    options: [
      "A presentation",
      "An interview",
      "A wedding or toast",
      "A pitch",
      "Nothing specific yet",
    ],
  },
  {
    id: "practice_time",
    question: "How much time can you give to practice?",
    options: [
      "5 minutes a day",
      "15 minutes a day",
      "A few times a week",
      "Whenever something's coming up",
    ],
  },
  // Last on purpose: the only question here that serves us rather than the
  // person answering. With no analytics cookies anywhere in the product, this
  // is the sole read on which channel actually brings people in.
  {
    id: "source",
    question: "How did you hear about Elovox?",
    options: [
      "A friend or coworker",
      "Social media",
      "Search or app store",
      "School or work",
      "Somewhere else",
    ],
  },
];

export type OnboardingAnswers = Record<string, string | string[]>;

const doneKey = (uid: string) => `elovox.onboarding.done.${uid}`;
const answersKey = (uid: string) => `elovox.onboarding.answers.${uid}`;

async function currentUid(): Promise<string> {
  if (!isFirebaseConfigured()) return "local";
  const user = await getUser();
  return user?.uid ?? "local";
}

function cacheDone(uid: string, record?: unknown): void {
  try {
    if (record !== undefined) {
      window.localStorage.setItem(answersKey(uid), JSON.stringify(record));
    }
    window.localStorage.setItem(doneKey(uid), "1");
  } catch {
    // storage full/blocked, Firestore is the durable record either way
  }
}

/**
 * Opens the gate on this device without claiming anything was persisted.
 * Only for the failure path in app/onboarding/page.tsx: answering the
 * questions again on another device is friction, but a gate that won't open
 * is a redirect loop through the whole app.
 */
export async function markOnboardedLocally(): Promise<void> {
  cacheDone(await currentUid());
}

export async function saveOnboarding(answers: OnboardingAnswers): Promise<void> {
  const uid = await currentUid();
  const record = { answers, completedAt: Date.now() };

  // Firestore FIRST, then the local flag. localStorage is a cache in front of
  // the only durable record, so setting it before the write means a failed
  // write leaves the device claiming "done" while nothing was persisted —
  // this device is fine forever and every other one asks the questions again.
  // That ordering is why onboarding could repeat. Also note iOS Safari evicts
  // localStorage after ~7 idle days, so the cache is expected to go missing;
  // the Firestore doc is what has to be there.
  if (uid !== "local") {
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(getDb(), "users", uid, "profile", "onboarding"), record);
  }

  cacheDone(uid, record);
}

export async function hasCompletedOnboarding(): Promise<boolean> {
  const uid = await currentUid();

  try {
    if (window.localStorage.getItem(doneKey(uid)) === "1") return true;
  } catch {
    // fall through to Firestore
  }
  if (uid === "local") return false;

  // Cache miss (new browser/device), ask Firestore once, then cache.
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(
      doc(getDb(), "users", uid, "profile", "onboarding")
    );
    if (snap.exists()) {
      window.localStorage.setItem(doneKey(uid), "1");
      return true;
    }
    return false;
  } catch {
    // Firestore unreachable, don't lock the user out of the app
    return true;
  }
}
