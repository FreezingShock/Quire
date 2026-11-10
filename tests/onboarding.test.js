import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry, normalizeEntry } from '../src/model.js';
import { SAMPLE_TITLE, TIPS, sampleEntry } from '../src/onboarding.js';
import { dayStreaks } from '../src/journal.js';

test('the sample entry is a dated note marked as a sample', () => {
  const sample = sampleEntry('2026-11-10');
  assert.equal(sample.title, SAMPLE_TITLE);
  assert.equal(sample.date, '2026-11-10');
  assert.equal(sample.kind, 'note');
  assert.equal(sample.sample, true);
  assert.equal(sample.mood, undefined); // no mood, so it never shows up in the mood chart
  const entry = createEntry(sample);
  assert.equal(entry.sample, true);
  assert.equal(entry.kind, 'note');
});

test('the sample body shows the main features as Markdown', () => {
  const { body } = sampleEntry('2026-11-10');
  assert.ok(body.startsWith('# Welcome to Quire'));
  assert.match(body, /^- \[ \] /m);
  assert.match(body, /^- \[x\] /m);
  assert.match(body, /^> /m);
});

test('a normal entry is not marked as a sample, and a stored flag survives normalizing', () => {
  assert.equal(createEntry({ body: 'hi' }).sample, false);
  assert.equal(normalizeEntry({ body: 'hi', sample: 'yes' }).sample, false);
  assert.equal(normalizeEntry({ body: 'hi', sample: true }).sample, true);
});

test('the sample does not start a streak', () => {
  const sample = createEntry(sampleEntry('2026-11-10'));
  assert.deepEqual(dayStreaks([sample], '2026-11-10'), { current: 0, longest: 0, todayDone: false });
  const real = createEntry({ date: '2026-11-10', body: 'x' });
  assert.deepEqual(dayStreaks([sample, real], '2026-11-10'), { current: 1, longest: 1, todayDone: true });
});

test('tips have unique ids and a title and body each', () => {
  const ids = new Set(TIPS.map((tip) => tip.id));
  assert.equal(ids.size, TIPS.length);
  for (const tip of TIPS) {
    assert.ok(tip.title.length > 0);
    assert.ok(tip.body.length > 0);
  }
});
