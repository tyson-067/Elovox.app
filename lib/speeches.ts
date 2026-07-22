// The pre-prepared speech library — Premium only.
//
// Free accounts practice on the daily challenge (lib/daily.ts): one
// AI-written 1-minute speech, three attempts, same for everybody. This
// ~30-second bank, along with interview practice, coaching on your own
// material, and Felix's custom-written speeches, is what Premium adds.
// Premium users can also replace any speech here with a freshly generated
// one on a similar or a different topic (/api/speech).

export interface LibrarySpeech {
  id: string;
  title: string;
  scenario: string; // one-line setup shown on the card
  text: string; // the script the user reads aloud
  topic: string; // used when regenerating "something similar"
}

export const SPEECHES: LibrarySpeech[] = [
  {
    id: "team-rally",
    title: "The Team Rally",
    scenario: "Monday morning. Your team is tired. Get them moving.",
    topic: "Rallying a team",
    text: "I know last week was a hard one. We missed the deadline, and nobody feels worse about that than the people in this room. But here's what I saw: nobody quit on it. Not once. So this week we do it differently. One priority, one owner, no side quests. If something's blocking you, say it out loud by ten a.m. We are closer than it feels. Let's go finish this thing.",
  },
  {
    id: "the-toast",
    title: "The Toast",
    scenario: "Glass raised, room quiet, everyone looking at you.",
    topic: "Celebrating someone",
    text: "When I met Sam ten years ago, I knew two things immediately: this person laughs louder than anyone in the building, and this person shows up. Every time. When my car died at midnight, Sam showed up. When I doubted myself, Sam showed up first. Tonight the tables are turned, and the whole room is here for you. To Sam — may we all love something the way you love showing up. Cheers.",
  },
  {
    id: "elevator-pitch",
    title: "The Elevator Pitch",
    scenario: "Thirty seconds with the one person who can say yes.",
    topic: "Selling an idea",
    text: "Every small business owner I know spends Sunday night doing paperwork they hate. Invoices, receipts, chasing payments — hours of it, every week. We built a tool that does it in nine minutes. Not a dashboard, not a platform — it just does the work. Three hundred businesses already use it, and they tell their friends. I'm raising a small round to keep up with them. I'd love thirty minutes to show you why they won't stop talking about it.",
  },
  {
    id: "hard-news",
    title: "The Hard News",
    scenario: "Deliver a difficult update without losing the room.",
    topic: "Bad news, told well",
    text: "I want to tell you where things actually stand, because you deserve the truth without spin. The project is six weeks behind, and the original plan won't get us back. That's on me. Here's what changes today: we cut two features, we ship the core, and we protect the launch date. I know that's not the update you wanted. But I'd rather earn your trust with bad news than lose it with good stories.",
  },
  {
    id: "graduation",
    title: "The Commencement Minute",
    scenario: "One minute of advice to people just starting out.",
    topic: "Advice and encouragement",
    text: "Nobody remembers their smoothest day. Think about it — the stories you tell are the storms, the flat tires, the presentations that fell apart. So my advice is simple: stop trying to have a smooth life. Try to have an interesting one. Say yes to the thing that scares you a little. Sit next to the stranger. Ask the question everyone's afraid to ask. Smooth is forgettable. You were not built to be forgettable.",
  },
  {
    id: "product-reveal",
    title: "The Product Reveal",
    scenario: "The demo moment. Make them lean forward.",
    topic: "Selling an idea",
    text: "For two years, people told us this couldn't be done. The battery was too small, the chip too slow, the idea too strange. We kept going anyway, because we'd seen what happens when it works. Today, you get to see it too. It weighs less than your keys. It lasts a full week. And it does the one thing every device before it promised and never delivered. Ladies and gentlemen — this is what we've been building.",
  },
  {
    id: "apology",
    title: "The Real Apology",
    scenario: "You got it wrong. Own it, out loud.",
    topic: "Admitting a mistake",
    text: "I owe you an apology, and I'm not going to dress it up. I made a call without asking the people it affected most — you. That was wrong, and it cost you real time and real trust. I'm not here to explain why it made sense at the time, because that's not the point. The point is what happens next: decisions like that one now go through you first. I hope you'll hold me to it.",
  },
  {
    id: "cause",
    title: "The Rallying Cause",
    scenario: "Ask a room to care — and to give.",
    topic: "Making a case for change",
    text: "Every night in this city, four hundred kids do homework in a library because home isn't quiet, or isn't safe, or isn't there. The library closes at eight. We want to keep the lights on until ten. That's it — that's the whole ask. Two more hours of somewhere to be. Staff, heat, light: twelve dollars keeps one kid's seat warm for a month. You've spent twelve dollars on worse. Keep the lights on with us.",
  },
];

export function getSpeech(id: string): LibrarySpeech | undefined {
  return SPEECHES.find((s) => s.id === id);
}
