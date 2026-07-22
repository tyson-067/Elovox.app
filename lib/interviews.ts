import type { InterviewType, InterviewTypeId } from "./types";

// Interview practice (Premium). Real questions, asked the way real panels
// ask them — not "tell me your strengths" but the follow-up that actually
// decides it. Each type has its own register: a hiring manager and a
// college admissions officer are listening for completely different things,
// and Felix scores accordingly.

export const INTERVIEW_TYPES: InterviewType[] = [
  {
    id: "job",
    name: "Job interview",
    description:
      "Hiring managers and panels. Behavioural questions, failure stories, and the ones people fumble.",
    questions: [
      "Tell me about a time you disagreed with your manager. What happened?",
      "Walk me through your background in about ninety seconds.",
      "Describe a project that failed. What would you do differently?",
      "Why do you want this role, and why now?",
      "Tell me about the hardest feedback you've ever received.",
      "What's something you believe about your field that most of your peers don't?",
      "Talk me through a decision you made with incomplete information.",
      "Why are you leaving your current role? Be honest.",
      "Tell me about a time you had to influence someone with no authority over them.",
      "What would your last manager say is your biggest weakness?",
    ],
  },
  {
    id: "college",
    name: "College admissions",
    description:
      "Alumni and admissions interviews. Who you are outside the transcript, and whether you can talk about it.",
    questions: [
      "Tell me about yourself — not your resume, you.",
      "Why this school, specifically? And don't say the campus is beautiful.",
      "What's something you've changed your mind about in the last two years?",
      "Describe a time you failed at something that mattered to you.",
      "What do you do when nobody assigns it to you?",
      "Tell me about a book, film, or idea you can't stop thinking about.",
      "How would your closest friend describe you when you're not in the room?",
      "What do you want to study, and what made you curious about it?",
      "Tell me about a time you disagreed with someone you respected.",
      "What would you want to be known for on our campus?",
    ],
  },
  {
    id: "scholarship",
    name: "Scholarship panel",
    description:
      "Committees deciding who gets funded. Impact, motive, and whether you'll be worth the bet.",
    questions: [
      "Why should this money go to you rather than the person after you?",
      "Tell us about a time you made something better for people around you.",
      "What obstacle shaped how you work today?",
      "Where do you see this funding taking you in five years?",
      "Describe a moment you led without a title.",
      "What's the biggest problem in your community, and what would you actually do about it?",
      "Tell us about a commitment you kept when it stopped being fun.",
      "How do you define success for yourself, separate from what others expect?",
    ],
  },
  {
    id: "grad-school",
    name: "Graduate school",
    description:
      "Faculty interviews. Research fit, intellectual seriousness, and how you handle being questioned.",
    questions: [
      "Describe your research interests in two minutes, for someone outside your subfield.",
      "Why our program, and who would you want to work with here?",
      "Tell me about a methodological problem you ran into and how you handled it.",
      "What's a paper in your field you think is wrong, and why?",
      "Where do you want your work to be in ten years?",
      "Talk about a time you had to abandon a hypothesis you were attached to.",
      "How do you handle long stretches with no results?",
      "What would you do if your advisor and you disagreed on direction?",
    ],
  },
  {
    id: "internship",
    name: "Internship / first job",
    description:
      "Early-career interviews where you have less experience to point at — and have to show potential instead.",
    questions: [
      "Tell me about yourself and why you applied here.",
      "You don't have much experience yet. Why should we take a chance on you?",
      "Describe a time you had to learn something quickly.",
      "Tell me about a group project that went badly. What was your part in it?",
      "What's a skill you've taught yourself, and how?",
      "How do you handle being told you're wrong?",
      "What do you want to get out of this internship, specifically?",
      "Tell me about something you built, organised, or started.",
    ],
  },
  {
    id: "medical-law",
    name: "Medical / law school",
    description:
      "Ethics-heavy panels and MMI-style stations. Judgement under pressure, said out loud.",
    questions: [
      "Why medicine — or law — and when did you actually decide?",
      "A patient refuses treatment you believe they need. Talk me through your thinking.",
      "Describe a time you saw something unethical. What did you do?",
      "How do you handle a mistake that harmed someone?",
      "Tell me about a time you had to deliver bad news.",
      "What's the biggest problem facing this profession right now?",
      "Describe a situation where the rules and the right thing conflicted.",
      "How will you handle the emotional weight of this work?",
    ],
  },
];

export function getInterviewType(id: InterviewTypeId | string): InterviewType {
  return INTERVIEW_TYPES.find((t) => t.id === id) ?? INTERVIEW_TYPES[0];
}

export function pickInterviewQuestion(
  id: InterviewTypeId | string,
  exclude?: string
): string {
  const bank = getInterviewType(id).questions;
  const pool = exclude ? bank.filter((q) => q !== exclude) : bank;
  return pool[Math.floor(Math.random() * pool.length)];
}
