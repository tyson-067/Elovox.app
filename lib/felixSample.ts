// The takes a stranger gets to hear. Both are written once by
// scripts/felix-voice-sample.mjs and played from static files, so the landing
// page never calls Fish Audio on a visitor's behalf (and /api/voice 401s
// without a signed-in uid anyway).
//
// Import-free, because the script runs this under Node's type stripping.
// Keep it the shape every real take has (lib/felixTake.ts): a verdict, one
// thing that worked, the one thing to fix, one instruction for the next
// attempt, no scores, no dashes.

export const FELIX_SAMPLE_TAKE =
  "Nice work. You came across as confident, but your pace picked up near the end. " +
  "Your strongest idea would land harder with a pause in front of it. " +
  "Try that last section again, and give the key point a little more space.";

// The second sample, on the Felix beside the report: the card's 0:27 note,
// spoken. He used to give a separate read on the quoted sentence, on the
// reasoning that repeating a line already printed beside him was the smaller
// thing he could say. The opposite turned out to be true. The 0:27 note is the
// one place the card tells you a habit is costing you authority, and hearing a
// coach say it while you look at the words it refers to is the demonstration
// the section is there to make: Elovox measures, Felix explains.
//
// Keep this in step with the 0:27 entry in REPORT_NOTES (app/page.tsx). It is
// the same coaching, and a visitor hears one while reading the other.
//
// No quotation marks: some voices read them aloud as words. So the printed
// note's quotes around um and basically are dropped here, which is also how a
// person would say the line out loud.
export const FELIX_SAMPLE_NOTE =
  "Cut um and basically. The filler and qualifier make you sound less certain. " +
  "Start clean: We're well ahead of schedule.";
