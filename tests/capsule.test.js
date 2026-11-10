import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addToISODate,
  capsuleStatus,
  countdownText,
  daysUntil,
  isHidden,
  redactEntry,
  redactSealed,
  rescheduledEntry,
  sealDateProblem,
  sealDateRange,
  sealedEntry,
  unsealedEntry,
  upcomingCapsules,
} from '../src/capsule.js';
import { createEntry, normalizeCapsule, normalizeEntry } from '../src/model.js';
import { contentOf } from '../src/versions.js';

const TODAY = '2026-11-10';

function written(fields = {}) {
  return createEntry({
    id: 'e1',
    title: 'A letter',
    body: '# Dear me\n\nHold on to this.',
    date: '2026-11-09',
    mood: 'good',
    weather: 'rain',
    tags: ['winter'],
    notebook: 'Letters',
    ink: { ops: [{ type: 'stroke', pts: [[0.1, 0.1], [0.2, 0.2]] }], h: 900 },
    ...fields,
  });
}

test('an entry with no capsule is not hidden', () => {
  const entry = written();
  assert.equal(capsuleStatus(entry, TODAY), 'none');
  assert.equal(isHidden(entry, TODAY), false);
});

test('a capsule is sealed until its open day, ready on it, and opened once unsealed', () => {
  const sealed = sealedEntry(written(), '2026-12-25', new Date('2026-11-10T12:00:00Z'));
  assert.equal(capsuleStatus(sealed, TODAY), 'sealed');
  assert.equal(capsuleStatus(sealed, '2026-12-24'), 'sealed');
  assert.equal(capsuleStatus(sealed, '2026-12-25'), 'ready');
  const opened = unsealedEntry(sealed, new Date('2026-12-25T09:00:00Z'));
  assert.equal(capsuleStatus(opened, '2026-12-25'), 'opened');
  assert.equal(isHidden(opened, '2027-01-01'), false);
});

test('a closed entry is redacted: no text, ink, mood, notebook, or tags', () => {
  const sealed = sealedEntry(written(), '2026-12-25');
  const [shown] = redactSealed([sealed], TODAY);
  assert.equal(shown.title, 'Time capsule');
  assert.equal(shown.body, '');
  assert.deepEqual(shown.tags, []);
  assert.equal(shown.notebook, null);
  assert.equal(shown.mood, null);
  assert.equal(shown.weather, null);
  assert.deepEqual(shown.ink.ops, []);
  assert.deepEqual(shown.images, {});
  // The parts the lists still need survive.
  assert.equal(shown.id, 'e1');
  assert.equal(shown.date, '2026-11-09');
  assert.equal(shown.capsule.openOn, '2026-12-25');
});

test('open entries pass through the redaction untouched', () => {
  const plain = written();
  const opened = unsealedEntry(sealedEntry(written({ id: 'e2' }), '2026-11-01'));
  const list = redactSealed([plain, opened], TODAY);
  assert.equal(list[0], plain);
  assert.equal(list[1], opened);
});

test('redacting does not change the stored entry', () => {
  const sealed = sealedEntry(written(), '2026-12-25');
  redactEntry(sealed);
  assert.equal(sealed.body, '# Dear me\n\nHold on to this.');
  assert.equal(sealed.title, 'A letter');
});

test('the countdown reads tomorrow, a number of days, or ready', () => {
  const sealed = sealedEntry(written(), '2026-11-11');
  assert.equal(countdownText(sealed, TODAY), 'Opens tomorrow');
  assert.equal(countdownText(sealedEntry(written(), '2026-11-22'), TODAY), 'Opens in 12 days');
  assert.equal(countdownText(sealedEntry(written(), '2026-11-01'), '2026-11-10'), 'Ready to open');
  assert.equal(countdownText(written(), TODAY), '');
});

test('daysUntil counts calendar days across a month and a daylight saving change', () => {
  assert.equal(daysUntil('2026-03-09', '2026-03-07'), 2);
  assert.equal(daysUntil('2027-01-01', '2026-12-31'), 1);
  assert.equal(daysUntil(TODAY, TODAY), 0);
});

test('addToISODate clamps to the end of a shorter month and rolls years', () => {
  assert.equal(addToISODate('2026-01-31', { months: 1 }), '2026-02-28');
  assert.equal(addToISODate('2028-01-31', { months: 1 }), '2028-02-29');
  assert.equal(addToISODate('2026-11-10', { months: 6 }), '2027-05-10');
  assert.equal(addToISODate('2026-11-10', { years: 5 }), '2031-11-10');
  assert.equal(addToISODate('2026-12-31', { days: 1 }), '2027-01-01');
  assert.equal(addToISODate('2026-11-10', { days: 1 }), '2026-11-11');
});

test('sealDateRange starts tomorrow and stops at the year limit', () => {
  const range = sealDateRange(TODAY);
  assert.equal(range.min, '2026-11-11');
  assert.equal(range.max, '2076-11-10');
});

test('sealDateProblem rejects today, the past, bad dates, and dates past the limit', () => {
  assert.equal(sealDateProblem('2026-11-11', TODAY), '');
  assert.match(sealDateProblem('2026-11-10', TODAY), /after today/);
  assert.match(sealDateProblem('2025-01-01', TODAY), /after today/);
  assert.match(sealDateProblem('', TODAY), /Pick a day/);
  assert.match(sealDateProblem('2099-01-01', TODAY), /within 50 years/);
});

test('rescheduling a capsule re-arms its notice', () => {
  const sealed = { ...sealedEntry(written(), '2026-11-20'), capsule: { ...sealedEntry(written(), '2026-11-20').capsule, notified: true } };
  const moved = rescheduledEntry(sealed, '2026-12-01');
  assert.equal(moved.capsule.openOn, '2026-12-01');
  assert.equal(moved.capsule.notified, false);
});

test('upcomingCapsules lists closed capsules soonest first and skips open entries', () => {
  const later = sealedEntry(written({ id: 'late' }), '2027-03-01');
  const soon = sealedEntry(written({ id: 'soon' }), '2026-11-15');
  const plain = written({ id: 'plain' });
  const opened = unsealedEntry(sealedEntry(written({ id: 'done' }), '2026-10-01'));
  const ids = upcomingCapsules([later, plain, soon, opened], TODAY).map((entry) => entry.id);
  assert.deepEqual(ids, ['soon', 'late']);
});

test('a capsule with a broken open day reads back as an ordinary entry', () => {
  assert.equal(normalizeCapsule({ openOn: '2026-02-30' }), null);
  assert.equal(normalizeCapsule(null), null);
  const entry = normalizeEntry({ id: 'x', capsule: { openOn: 'soon' } });
  assert.equal(entry.capsule, null);
});

test('a capsule survives a normalize round trip, and its fields keep their types', () => {
  const sealed = sealedEntry(written(), '2026-12-25', new Date('2026-11-10T12:00:00Z'));
  const back = normalizeEntry(JSON.parse(JSON.stringify(sealed)));
  assert.deepEqual(back.capsule, sealed.capsule);
  assert.equal(back.capsule.notified, false);
  assert.equal(back.capsule.unsealedAt, null);
});

test('capsule fields stay out of version content, so sealing alone does not add a version', () => {
  const plain = written();
  const sealed = sealedEntry(plain, '2026-12-25');
  assert.deepEqual(contentOf(sealed), contentOf(plain));
});

test('arrival notices go out once per capsule, and the library is read once a day', async () => {
  const { capsuleActionMethods } = await import('../src/controller/capsule-actions.js');
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = addToISODate(today, { days: -1 });
  const tomorrow = addToISODate(today, { days: 1 });
  const stored = [
    { ...written({ id: 'ready-one' }), capsule: normalizeCapsule({ openOn: yesterday, sealedAt: '2026-01-01T00:00:00Z' }) },
    { ...written({ id: 'still-sealed' }), capsule: normalizeCapsule({ openOn: tomorrow, sealedAt: '2026-01-01T00:00:00Z' }) },
    written({ id: 'plain' }),
  ];
  const saved = [];
  let reads = 0;
  const app = {
    capsuleScanDay: null,
    store: {
      list: async () => {
        reads += 1;
        return stored.map((entry) => structuredClone(entry));
      },
      save: async (entry) => {
        saved.push(entry);
        return entry;
      },
    },
  };
  const sent = [];
  const send = async (body, tag) => sent.push(tag);

  await capsuleActionMethods.announceArrivedCapsules.call(app, send);
  assert.deepEqual(sent, ['quire-capsule-ready-one']);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].capsule.notified, true);

  // Same day again: no read, no second notice.
  await capsuleActionMethods.announceArrivedCapsules.call(app, send);
  assert.equal(reads, 1);
  assert.equal(sent.length, 1);

  // A failed send is tried again the next time, and the day is not marked done.
  const failing = { ...app, capsuleScanDay: null };
  const boom = async () => { throw new Error('no notifications'); };
  await assert.rejects(capsuleActionMethods.announceArrivedCapsules.call(failing, boom));
  assert.equal(failing.capsuleScanDay, null);
});
