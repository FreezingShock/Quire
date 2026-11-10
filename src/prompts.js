/**
 * Daily writing prompts. The prompt for a day is picked from its position in
 * the calendar, so every day gets a different one and the cycle only repeats
 * after the whole list has come round. "Another" steps forward by one. No DOM
 * and no storage.
 */

export const PROMPTS = Object.freeze([
  'What did today look like from the inside?',
  'Describe a small thing you noticed this week that most people would miss.',
  'What are you putting off, and what is the smallest step you could take on it?',
  'Write about a place you keep returning to in your head.',
  'Who made you laugh recently, and what were you both talking about?',
  'What do you want more of next month? What would you give up to get it?',
  'Finish this sentence three different ways: "The hardest part of my day was..."',
  'Describe the sound of the room you are sitting in right now.',
  'What is something you believed a year ago that you no longer hold?',
  'Write a letter to yourself from five years from now.',
  'What did you eat today, and what did it remind you of?',
  'Which person in your life would you most like to understand better, and why?',
  'What felt easy today that used to feel hard?',
  'List five things you are grateful for, then pick one and go deeper.',
  'Describe an object you own that has a story behind it.',
  'What would you do with a free afternoon with no plans and no one to answer to?',
  'What is a question you keep asking yourself without finding an answer?',
  'Tell the story of a mistake that turned out to be useful.',
  'What does rest look like for you, and when did you last have it?',
  'Describe your neighborhood to someone who has never been there.',
  'What are you proud of that nobody has said out loud yet?',
  'Write about a song, a book, or a film that changed how you see something.',
  'If today had a color and a weather report, what would they be?',
  'What is one habit you would like to start, and what is standing in the way?',
  'Recall a meal that meant something to you. Who was there?',
  'What are you afraid of losing? What would you do if you lost it?',
  'Describe a moment this week when you felt fully present.',
  'What do you wish people knew about how your days go?',
  'Pick a childhood memory you have not thought about in a long time. Write it down as you remember it.',
  'What would your ideal ordinary Tuesday look like, hour by hour?',
  'Write about a time someone changed your mind.',
  'What is something you are curious about right now? Where would you start looking?',
  'Describe what you can see from the window closest to you, as if it were new.',
  'What do you need to hear today? Write it as if a friend were saying it.',
  'Where were you a year ago today, and what has changed since?',
  'Write about a conversation you wish you had handled differently.',
  'What small kindness did you receive or give this week?',
  'What is the best advice you were ever given, and did you follow it?',
  'Make a list of ten things that cost you nothing and still matter to you.',
  'What is something you are working on that no one else knows about?',
  'Describe a smell that takes you straight back somewhere.',
  'What does home mean to you today?',
  'Write about a fear you have outgrown.',
  'What would you tell the person you were at the start of this year?',
  'Describe a task you do without thinking. What goes on in your head while you do it?',
  'What is one thing you are looking forward to, and what makes it worth waiting for?',
  'Write a short scene with only dialogue. Two people, one problem, no narrator.',
  'What did you learn about yourself this week, even if it was small?',
]);

const DAY_MS = 86400000;

/** Whole days since 1970-01-01 for a YYYY-MM-DD string, read in UTC so no time zone can shift it. */
function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

/**
 * The prompt for the day `iso`. `skip` moves forward through the list, so the
 * "Another" button can offer the next one without changing the day's order.
 */
export function promptFor(iso, skip = 0) {
  const count = PROMPTS.length;
  const index = (((dayNumber(iso) + skip) % count) + count) % count;
  return PROMPTS[index];
}
