import { isFirebaseConfigured, getDb, getUser } from "./firebase";

// Post-signup onboarding: a short run of quick multiple-choice questions
// answered once, before first dashboard access. Answers live in Firestore at
// users/{uid}/profile/onboarding (localStorage fallback without Firebase),
// and completion is cached in localStorage so the RequireAuth gate doesn't
// hit Firestore on every navigation. Add/remove questions freely — the
// onboarding screen renders whatever is in this list and sizes its progress
// bar to the count.

export interface OnboardingQuestion {
  id: string;
  question: string;
  hint?: string;
  multi?: boolean; // multi-select (needs an explicit Continue)
  options: string[];
}

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "role",
    question: "Which sounds most like you?",
    options: [
      "Student",
      "Professional",
      "Manager or leader",
      "Founder or entrepreneur",
      "Creator or performer",
      "Something else",
    ],
  },
  {
    id: "age",
    question: "How old are you?",
    options: ["Under 18", "18–24", "25–34", "35–44", "45+"],
  },
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
    id: "context",
    question: "Where do you most need to speak well?",
    options: [
      "Work meetings",
      "Presentations & pitches",
      "Interviews",
      "Teaching or the classroom",
      "Social & personal",
      "On camera or content",
    ],
  },
  {
    id: "frequency",
    question: "How often do you speak in front of others?",
    options: [
      "Most days",
      "A few times a week",
      "A few times a month",
      "Almost never",
    ],
  },
  {
    id: "comfort",
    question: "How does speaking in front of people feel right now?",
    options: [
      "Honestly, terrifying",
      "Nervous, but I manage",
      "Fairly comfortable",
      "I enjoy the spotlight",
    ],
  },
  {
    id: "experience",
    question: "How would you rate your speaking today?",
    options: ["Just starting out", "Getting there", "Pretty solid", "Advanced"],
  },
  {
    id: "audience_size",
    question: "Which audience feels hardest?",
    options: [
      "One-on-one",
      "A small group",
      "A full room",
      "A large stage",
      "On camera",
    ],
  },
  {
    id: "challenge",
    question: "What trips you up most?",
    options: [
      "Nerves",
      "Filler words (um, like)",
      "Pacing — I rush",
      "A flat, monotone voice",
      "Losing my train of thought",
      "Body language",
    ],
  },
  {
    id: "nerves",
    question: "When you're nervous, what happens?",
    options: [
      "My heart races",
      "My mind goes blank",
      "I speed up",
      "My voice shakes",
      "I ramble",
    ],
  },
  {
    id: "focus",
    question: "Which of these matter most to you?",
    hint: "Pick as many as you like",
    multi: true,
    options: [
      "Confidence",
      "Clarity",
      "Persuasion",
      "Storytelling",
      "Executive presence",
      "Warmth",
    ],
  },
  {
    id: "voice_goal",
    question: "What should your voice project more of?",
    options: ["Authority", "Warmth", "Energy", "Calm", "Enthusiasm"],
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
  {
    id: "record_comfort",
    question: "How do you feel about recording yourself?",
    options: ["I love it", "Fine with it", "A little awkward", "I dread it"],
  },
  {
    id: "feedback_style",
    question: "How do you like your feedback?",
    options: [
      "Direct and blunt",
      "Warm and encouraging",
      "Detailed and technical",
      "Quick and simple",
    ],
  },
  {
    id: "accountability",
    question: "What keeps you coming back?",
    options: [
      "Streaks",
      "Watching my scores climb",
      "Daily challenges",
      "Reminders",
      "My own drive",
    ],
  },
  {
    id: "commitment",
    question: "How ready are you to put in the reps?",
    options: ["All in", "Motivated", "Curious", "Just exploring"],
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

export async function saveOnboarding(answers: OnboardingAnswers): Promise<void> {
  const uid = await currentUid();
  const record = { answers, completedAt: Date.now() };

  try {
    window.localStorage.setItem(answersKey(uid), JSON.stringify(record));
    window.localStorage.setItem(doneKey(uid), "1");
  } catch {
    // storage full/blocked — Firestore write below still gates correctly
  }

  if (uid !== "local") {
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(getDb(), "users", uid, "profile", "onboarding"), record);
  }
}

export async function hasCompletedOnboarding(): Promise<boolean> {
  const uid = await currentUid();

  try {
    if (window.localStorage.getItem(doneKey(uid)) === "1") return true;
  } catch {
    // fall through to Firestore
  }
  if (uid === "local") return false;

  // Cache miss (new browser/device) — ask Firestore once, then cache.
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
    // Firestore unreachable — don't lock the user out of the app
    return true;
  }
}
