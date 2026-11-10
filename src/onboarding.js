/**
 * First run: the sample entry a new library starts with, and the short tips
 * shown on the dashboard. Plain data and no DOM, so the copy can be tested.
 */

export const SAMPLE_TITLE = 'Welcome to Quire';

/** The sample is a note, not a journal, so it never counts as today's journal. */
export function sampleEntry(today) {
  return {
    title: SAMPLE_TITLE,
    date: today,
    kind: 'note',
    sample: true,
    body: [
      '# Welcome to Quire',
      '',
      'This is a sample entry. Read it, change it, or delete it when you are ready.',
      '',
      'Quire is a journal and a drawing page. Everything you write stays in this browser, with no account and no upload.',
      '',
      '## Try these',
      '',
      '- [ ] Pick a mood and weather in the bar above the page',
      '- [ ] Click this box to check it off',
      '- [x] Open this entry (you just did)',
      '- [ ] Draw a quick sketch with the pencil in the toolbox',
      '',
      '> Press Enter after a line to start the next one. Markdown shows as you type.',
      '',
      'Press F1 at any time to see every keyboard shortcut.',
    ].join('\n'),
  };
}

export const TIPS = Object.freeze([
  {
    id: 'write',
    title: 'Write in Markdown',
    body: 'Type # for a heading, > for a quote, or - for a list. The markup shows only on the line you are editing.',
  },
  {
    id: 'draw',
    title: 'Draw on the page',
    body: 'Pick a pencil, brush, or shape from the toolbox. Right-click a swatch to change the page color.',
  },
  {
    id: 'habit',
    title: 'Keep the streak going',
    body: 'Alt+T opens today’s journal, or starts one. The toolbar counts the days in a row you have written.',
  },
  {
    id: 'keep',
    title: 'Your entries stay here',
    body: 'Nothing is uploaded. Use File > Back up all entries to save a copy you can restore later.',
  },
]);
