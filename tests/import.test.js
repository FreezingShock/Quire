import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayInZone, hashText, markdownEntry, parseDayOneJson, parseImportFile, splitFrontMatter } from '../src/import.js';

const dayOne = JSON.stringify({
  metadata: { version: '1.0' },
  entries: [
    {
      uuid: 'AB-12_cd',
      creationDate: '2024-03-02T23:30:00Z',
      modifiedDate: '2024-03-03T08:00:00Z',
      text: '# Harbor\n\nGulls over the pier.',
      tags: ['travel', 'winter'],
      starred: true,
      timeZone: 'America/New_York',
    },
    { uuid: 'no-date', text: 'missing a creation date' },
  ],
});

test('parseDayOneJson maps entries, zone-local days, tags and stars', () => {
  const { entries, skipped, format } = parseDayOneJson(dayOne);
  assert.equal(format, 'day-one');
  assert.equal(skipped, 1);
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.id, 'd1-AB-12_cd');
  // 23:30 UTC on March 2 is still March 2 in New York.
  assert.equal(entry.date, '2024-03-02');
  assert.deepEqual(entry.tags, ['travel', 'winter']);
  assert.equal(entry.favorite, true);
  assert.equal(entry.body, '# Harbor\n\nGulls over the pier.');
  assert.equal(entry.createdAt, '2024-03-02T23:30:00.000Z');
  assert.equal(entry.updatedAt, '2024-03-03T08:00:00.000Z');
});

test('parseDayOneJson refuses Quire backups and unrelated JSON', () => {
  assert.throws(() => parseDayOneJson(JSON.stringify({ app: 'quire', entries: [] })), /Restore from backup/);
  assert.throws(() => parseDayOneJson(JSON.stringify({ hello: 1 })), /not a Day One export/);
});

test('dayInZone falls back to the browser day for a bad zone', () => {
  const date = new Date('2024-06-01T12:00:00Z');
  assert.equal(dayInZone(date, 'Not/AZone'), dayInZone(date, undefined));
  assert.equal(dayInZone(date, 'Asia/Tokyo'), '2024-06-01');
});

test('splitFrontMatter reads the fields and the body', () => {
  const { fields, body } = splitFrontMatter('---\ntitle: "Rainy"\ndate: 2026-02-03\n---\n\nHello there.\n');
  assert.equal(fields.title, '"Rainy"');
  assert.equal(fields.date, '2026-02-03');
  assert.equal(body, '\nHello there.\n');
});

test('markdownEntry reads a Quire export back', () => {
  const source = [
    '---',
    'title: "Trip north"',
    'date: 2025-07-04',
    'kind: poem',
    'mood: good',
    'weather: sunny',
    'tags: ["road", "summer"]',
    '---',
    '',
    'We drove all day.',
    '',
  ].join('\n');
  const entry = markdownEntry('trip.md', source, '2026-01-01');
  assert.equal(entry.title, 'Trip north');
  assert.equal(entry.date, '2025-07-04');
  assert.equal(entry.kind, 'poem');
  assert.equal(entry.mood, 'good');
  assert.equal(entry.weather, 'sunny');
  assert.deepEqual(entry.tags, ['road', 'summer']);
  assert.equal(entry.body, 'We drove all day.');
});

test('local picture lines from an export are dropped, web pictures stay', () => {
  const source = '---\ntitle: "Pics"\ndate: 2025-01-01\n---\n\nBefore.\n\n![Drawing](Pics%20drawing.png)\n\n![Web](https://example.com/a.png)\n';
  const entry = markdownEntry('pics.md', source, '2026-01-01');
  assert.equal(entry.body, 'Before.\n\n![Web](https://example.com/a.png)');
});

test('plain Markdown takes its title from the file name and today as its date', () => {
  const entry = markdownEntry('notes-from-april.md', '# Plans\n\nRead more.', '2026-04-10');
  assert.equal(entry.title, 'notes-from-april');
  assert.equal(entry.date, '2026-04-10');
  assert.equal(entry.body, '# Plans\n\nRead more.');
});

test('imports get the same id when the same file is read twice', () => {
  const a = markdownEntry('a.md', 'Same words', '2026-01-01');
  const b = markdownEntry('a.md', 'Same words', '2026-01-01');
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, markdownEntry('a.md', 'Other words', '2026-01-01').id);
  assert.match(hashText('x'), /^[0-9a-f]{8}$/);
});

test('parseImportFile picks the format from the file name or the contents', () => {
  assert.equal(parseImportFile('Journal.json', dayOne).format, 'day-one');
  assert.equal(parseImportFile('export', dayOne).format, 'day-one');
  assert.equal(parseImportFile('day.md', 'Just text', '2026-01-01').format, 'markdown');
});
