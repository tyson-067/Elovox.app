import type { SocialSkill, SocialSkillId } from "./types";

// Social skills practice (Premium). Not speeches: the two-line moments that
// decide how a day goes. Starting a chat, ending one, saying no, saying
// sorry. Each prompt is a concrete scene, and the user answers it out loud
// in their own words; scoring runs against the "conversation" category so
// Felix judges it as talk between people, not as a talk.

export const SOCIAL_SKILLS: SocialSkill[] = [
  {
    id: "small-talk",
    name: "Small talk",
    description:
      "Strangers, elevators, school pickups. Starting a conversation from nothing, and keeping it alive.",
    prompts: [
      "You're early to a meeting. It's just you and a director you've never met. Start the conversation.",
      "The elevator ride with your new neighbor is eight floors long. Say something.",
      "You're seated next to a stranger at a wedding dinner. Open, and keep it going.",
      "The barber asks how your week's going. Give them more than 'fine, thanks'.",
      "A parent you half-recognize is waiting next to you at school pickup. Break the ice.",
      "Your taxi driver wants to chat and you have twenty minutes. Meet them halfway.",
    ],
  },
  {
    id: "ending-conversations",
    name: "Ending a conversation",
    description:
      "Leaving a chat warmly, without the slow fade or the fake phone call.",
    prompts: [
      "The party chat has run its course and you'd like to move on. End it warmly.",
      "A colleague has been talking at your desk for ten minutes and you have a deadline. Wrap it up kindly.",
      "The phone call with your relative is on its third goodbye. Land the real one.",
      "You're at a networking event and want to meet more people. Leave this conversation well.",
      "Your neighbor caught you at the door and you're already late. Exit without hurting them.",
      "A first date is winding down. Close it honestly, whatever you've decided.",
    ],
  },
  {
    id: "excusing-yourself",
    name: "Excusing yourself",
    description:
      "Leaving the room, the dinner, or the call without making it a thing.",
    prompts: [
      "You need to leave the dinner before dessert. Excuse yourself without a cover story.",
      "Your phone is buzzing with something genuinely urgent, mid-conversation. Step away gracefully.",
      "The meeting is running over and you have a hard stop. Say so and go.",
      "You're stuck in a group story you've heard twice. Slip out politely.",
      "You feel a headache building at a friend's party. Make your exit kind and quick.",
      "You need a minute alone at a family gathering. Excuse yourself without causing alarm.",
    ],
  },
  {
    id: "boundaries",
    name: "Setting boundaries",
    description:
      "Saying no, drawing lines, and holding them without an apology tour.",
    prompts: [
      "A coworker keeps handing you their tasks. Say no to the next one, plainly and kindly.",
      "A friend calls after midnight for the third time this week, and it's never urgent. Draw the line.",
      "Your relative keeps asking when you're settling down. Close the topic without starting a war.",
      "Your boss messages you on weekends and expects replies. Set the boundary.",
      "A friend keeps borrowing money and forgetting. Tell them it stops here.",
      "Someone keeps teasing you about the same sore spot. Tell them to drop it, once and clearly.",
    ],
  },
  {
    id: "disagreeing",
    name: "Disagreeing politely",
    description:
      "Saying 'I think that's wrong' in a way people can actually hear.",
    prompts: [
      "In a meeting, everyone's nodding at a plan you think will fail. Say so.",
      "A friend states a fact you know is wrong, in front of the group. Correct it without embarrassing them.",
      "Your parent has strong opinions about your career. Push back with respect.",
      "Your book club loved the book. You didn't. Make your case without souring the room.",
      "A client wants something you think will hurt them. Disagree and keep the relationship.",
      "A relative at dinner airs an opinion you think is genuinely wrong. Speak up without blowing up the evening.",
    ],
  },
  {
    id: "compliments",
    name: "Compliments",
    description: "Giving praise that lands, and taking it without deflecting.",
    prompts: [
      "A teammate quietly saved the project. Tell them, specifically, so it lands.",
      "Someone compliments the work you're most proud of. Accept it without deflecting.",
      "Your friend looks great tonight and is nervous about the evening. Say it so they believe it.",
      "Your manager praises you in front of the team. Take it gracefully, no 'it was nothing'.",
      "The colleague you only know from meetings did something you admired. Tell them, without making it strange.",
      "A mentor changed how you work. Tell them what they did for you.",
    ],
  },
  {
    id: "awkward-silence",
    name: "Awkward silence",
    description:
      "The pause that's gone on too long, and how to break it without panic.",
    prompts: [
      "The conversation just died mid-dinner and everyone's looking at their plates. Restart it.",
      "You're in a car with someone you barely know and the radio's off. Fill the silence, naturally.",
      "The video call has gone quiet while everyone waits for someone else. Be the someone.",
      "You just said something that landed badly, and the room went quiet. Recover.",
      "Your coffee date is checking their phone and the table's gone silent. Bring it back.",
      "A pause has stretched past comfortable with your new colleague. Break it without rushing.",
    ],
  },
  {
    id: "joining-groups",
    name: "Joining a group",
    description:
      "Walking up to a circle mid-conversation and finding your way in.",
    prompts: [
      "Three coworkers are mid-conversation at the coffee machine. Join without derailing it.",
      "You arrive at the party late and everyone's already in circles. Pick one and enter.",
      "Your partner's friends are deep in an in-joke you don't get. Find your way in.",
      "A group at the conference is discussing something you actually know. Add to it, don't take it over.",
      "New team, first standup, and they all know each other. Introduce yourself into the flow.",
      "The parents at the birthday party all seem to be friends already. Walk up and join.",
    ],
  },
  {
    id: "apologies",
    name: "Apologizing",
    description:
      "Owning it properly: no excuse pile, no groveling, no 'sorry you feel that way'.",
    prompts: [
      "You forgot your friend's birthday, and they noticed. Apologize like you mean it.",
      "You snapped at a coworker who didn't deserve it. Make it right.",
      "You're twenty minutes late and they've been waiting outside. Own it without a pile of excuses.",
      "You repeated something told to you in confidence, and it got back to them. Apologize properly.",
      "Your mistake cost the team a weekend. Say sorry to the room.",
      "You canceled on the same friend twice. Apologize without promising what you can't keep.",
    ],
  },
  {
    id: "declining-invitations",
    name: "Declining an invitation",
    description:
      "Saying no to plans without a fake excuse or a bruised friendship.",
    prompts: [
      "You're invited to a wedding you can't afford to attend. Decline with warmth.",
      "A coworker invites you to drinks and you just want to go home. Say no without inventing a story.",
      "Your friend wants you at their weekly game night, every week. Decline the standing invitation.",
      "Family expects you at every Sunday dinner. Tell them you'll miss this one.",
      "You said 'maybe' to something you know is a no. Turn it into a real answer.",
      "An old friend invites you back to a group you've outgrown. Decline and keep the friend.",
    ],
  },
  {
    id: "asking-for-help",
    name: "Asking for help",
    description:
      "Asking before you're drowning, in a way that's easy to answer.",
    prompts: [
      "You're three days behind and haven't told anyone. Ask your manager for help.",
      "The instructions made no sense but everyone else nodded. Ask the question anyway.",
      "You need a friend to help you move this weekend. Ask like it's okay to say no.",
      "You've been in over your head for weeks, and hiding it well. Tell someone you trust and ask what they'd do.",
      "Ask a busy expert for twenty minutes of their time, and make it easy to say yes.",
      "You've been carrying too much at home. Ask your partner to take something off your plate.",
    ],
  },
  {
    id: "receiving-criticism",
    name: "Receiving criticism",
    description:
      "Hearing it, sorting the fair from the unfair, and answering without armour.",
    prompts: [
      "Your manager says your report missed the mark. Respond without getting defensive.",
      "A friend tells you that you've been distant lately. Take it in and answer honestly.",
      "Your work is critiqued in front of the group, and some of it is fair. Respond to the fair part.",
      "Your flatmate says you never do your share, and they're about half right. Answer the fair half.",
      "Your partner says you interrupt them. Your first instinct is 'no I don't'. Say the second thing instead.",
      "Someone junior points out your mistake. Thank them like you mean it.",
    ],
  },
  {
    id: "reconnecting",
    name: "Reconnecting",
    description:
      "The call you keep not making. Old friends, drifted relatives, and getting past the first minute.",
    prompts: [
      "Call a friend you haven't spoken to in two years, for no reason except missing them. Say the first minute.",
      "You run into an old classmate at the supermarket. Get past 'we should catch up sometime'.",
      "A friendship faded after an argument neither of you resolved. Be the one who calls.",
      "Your old mentor probably doesn't remember you. Reintroduce yourself and say why you're calling.",
      "You've drifted from a relative you used to be close to. Make the call, and open it.",
      "An old friend rang you first. Respond like you're glad, because you are.",
    ],
  },
];

export function getSocialSkill(id: SocialSkillId | string): SocialSkill {
  return SOCIAL_SKILLS.find((s) => s.id === id) ?? SOCIAL_SKILLS[0];
}

export function pickSocialPrompt(
  id: SocialSkillId | string,
  exclude?: string
): string {
  const bank = getSocialSkill(id).prompts;
  const pool = exclude ? bank.filter((p) => p !== exclude) : bank;
  return pool[Math.floor(Math.random() * pool.length)];
}
