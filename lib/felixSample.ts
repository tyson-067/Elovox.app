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

// The second sample, on the Felix beside the report. His read on the QUOTED
// SENTENCE as a whole — what worked in it, what did not, what to do — rather
// than one of the three timestamped notes printed beside it. The notes are the
// card's job; this is the coach's, and repeating a line the reader can already
// see was the smaller of the two things he could say.
//
// Not printed anywhere, exactly like FELIX_SAMPLE_TAKE above. The stamp still
// earns its keep: it catches these words changing without the MP3 being re-cut,
// which is the failure that is inaudible to whoever made the change because
// their browser has the old file cached.
//
// No quotation marks: some voices read them aloud as words.
export const FELIX_SAMPLE_NOTE =
  "Good sentence overall. You built up to the number and said it once. " +
  "The one problem is um, basically in the middle. Cut those two words.";
