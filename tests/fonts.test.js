import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURATED_FONTS,
  MAX_RECENTS,
  TEXT_FONTS,
  addRecent,
  cleanName,
  detectInstalled,
  familiesFromLocalFonts,
  familyName,
  filterFamilies,
  fontLabel,
  fontStackFor,
  genericOf,
  isKnownFont,
  isSystemFont,
  listFamilies,
  listSystemFonts,
  normalizeFontId,
  normalizeRecents,
  systemFontId,
  useFontLister,
} from '../src/fonts.js';

test('built-in ids keep their stacks, and unknown ids fall back to serif', () => {
  assert.equal(fontStackFor('serif'), TEXT_FONTS.serif);
  assert.equal(fontStackFor('mono'), TEXT_FONTS.mono);
  assert.equal(fontStackFor('nonsense'), TEXT_FONTS.serif);
  assert.equal(fontStackFor(undefined), TEXT_FONTS.serif);
  assert.equal(normalizeFontId('family:Georgia'), 'family:Georgia');
  assert.equal(normalizeFontId('garbage'), 'serif');
});

test('a chosen system font is quoted and falls back to a generic of the same kind', () => {
  const stack = fontStackFor(systemFontId('Bahnschrift'));
  assert.ok(stack.startsWith('"Bahnschrift", '));
  assert.ok(stack.endsWith(TEXT_FONTS.sans));
  assert.ok(fontStackFor(systemFontId('Garamond')).endsWith(TEXT_FONTS.serif));
  assert.ok(fontStackFor(systemFontId('Consolas')).endsWith(TEXT_FONTS.mono));
});

test('names are cleaned so a font name can never break out of a CSS value or a style block', () => {
  const hostile = 'Evil"; } body { display:none } <script>';
  const cleaned = cleanName(hostile);
  assert.ok(!/["'\\<>;{}]/.test(cleaned));
  const stack = fontStackFor(systemFontId(hostile));
  assert.ok(!/[;{}<>]/.test(stack));
  assert.equal(isSystemFont('family:'), false);
  assert.equal(isSystemFont('family:"; }'), false);
  assert.ok(cleanName('x'.repeat(500)).length <= 80);
});

test('genericOf guesses the fallback kind from the name', () => {
  assert.equal(genericOf('Courier New'), 'mono');
  assert.equal(genericOf('Lucida Console'), 'mono');
  assert.equal(genericOf('Noto Serif'), 'serif');
  assert.equal(genericOf('Iowan Old Style'), 'serif');
  assert.equal(genericOf('Century Gothic'), 'sans');
  assert.equal(genericOf('Verdana'), 'sans');
});

test('labels show the built-in name or the family name', () => {
  assert.equal(fontLabel('sans'), 'Sans');
  assert.equal(fontLabel(systemFontId('Calibri')), 'Calibri');
  assert.equal(fontLabel('family:'), 'Serif');
  assert.equal(familyName('serif'), '');
  assert.equal(isKnownFont('serif'), true);
  assert.equal(isKnownFont('family:Calibri'), true);
});

test('recents keep the newest first, without duplicates, built-ins, or junk, and stop at the limit', () => {
  let recents = [];
  recents = addRecent(recents, 'serif');
  assert.deepEqual(recents, [], 'built-in fonts are not stored as recents');
  recents = addRecent(recents, systemFontId('Calibri'));
  recents = addRecent(recents, systemFontId('Garamond'));
  recents = addRecent(recents, systemFontId('Calibri'));
  assert.deepEqual(recents, [systemFontId('Calibri'), systemFontId('Garamond')]);
  const many = Array.from({ length: 10 }, (_, index) => systemFontId(`Font ${index}`));
  assert.equal(normalizeRecents(many).length, MAX_RECENTS);
  assert.deepEqual(normalizeRecents(['bogus', 42, null, systemFontId('Arial')]), [systemFontId('Arial')]);
  assert.deepEqual(normalizeRecents('not a list'), []);
});

test('family lists are cleaned, unique, and sorted', () => {
  assert.deepEqual(listFamilies(['Verdana', 'arial', 'Verdana', '  ', 'Calibri', null]), ['arial', 'Calibri', 'Verdana']);
});

test('search needs every word, puts prefix matches first, and ignores case', () => {
  const names = ['Arial', 'Arial Black', 'Courier New', 'Liberation Mono', 'Noto Sans Mono'];
  assert.deepEqual(filterFamilies(names, ''), names);
  assert.deepEqual(filterFamilies(names, 'ARIAL'), ['Arial', 'Arial Black']);
  assert.deepEqual(filterFamilies(names, 'sans mono'), ['Noto Sans Mono']);
  assert.deepEqual(filterFamilies(names, 'mono'), ['Liberation Mono', 'Noto Sans Mono']);
  assert.deepEqual(filterFamilies(names, 'zzz'), []);
});

test('local font access entries are merged by family', () => {
  const fonts = [
    { family: 'Calibri', style: 'Regular' },
    { family: 'Calibri', style: 'Bold' },
    { family: 'Cambria', style: 'Regular' },
  ];
  assert.deepEqual(familiesFromLocalFonts(fonts), ['Calibri', 'Cambria']);
  assert.deepEqual(familiesFromLocalFonts(undefined), []);
});

test('detection finds a font that draws differently from a fallback, and skips missing ones', () => {
  // Fake measurer: a named font "Present" has its own width; anything else draws like the generic fallback.
  const measure = (font) => {
    if (font.includes('"Present"')) return 500;
    if (font.includes('monospace')) return 300;
    if (font.includes('sans-serif')) return 200;
    return 210;
  };
  assert.deepEqual(detectInstalled(['Missing', 'Present', 'Also Missing'], measure), ['Present']);
  assert.deepEqual(detectInstalled(['', '   '], measure), []);
});

test('the curated list has no duplicates', () => {
  assert.equal(new Set(CURATED_FONTS).size, CURATED_FONTS.length);
});

test('listSystemFonts uses a registered app lister first, and reports where its list came from', async () => {
  useFontLister(() => ['Zeta', 'Alpha', 'Alpha']);
  try {
    const result = await listSystemFonts();
    assert.equal(result.source, 'app');
    assert.deepEqual(result.families, ['Alpha', 'Zeta']);
  } finally {
    useFontLister(null);
  }
});

test('listSystemFonts without a browser font API and without a canvas reports no list rather than failing', async () => {
  // Node has no queryLocalFonts, no document, and no canvas.
  const result = await listSystemFonts({ allowPrompt: true });
  assert.equal(result.source, 'none');
  assert.deepEqual(result.families, []);
  assert.equal(result.access, 'unsupported');
});

test('in the desktop shell, the fonts plugin lists the system fonts', async () => {
  const calls = [];
  globalThis.__QUIRE_DESKTOP__ = Object.freeze({ shell: 'tauri', version: '0.1.0', platform: 'windows' });
  globalThis.__TAURI_INTERNALS__ = { invoke: async (command) => {
    calls.push(command);
    return ['Zeta', 'Alpha', 'Alpha'];
  } };
  try {
    const result = await listSystemFonts();
    assert.equal(result.source, 'app');
    assert.deepEqual(result.families, ['Alpha', 'Zeta']);
    assert.deepEqual(calls, ['plugin:fonts|list_system_fonts']);
  } finally {
    delete globalThis.__QUIRE_DESKTOP__;
    delete globalThis.__TAURI_INTERNALS__;
  }
});

test('a lister that throws falls through to the browser path instead of breaking the picker', async () => {
  useFontLister(() => {
    throw new Error('no shell');
  });
  try {
    const result = await listSystemFonts();
    assert.notEqual(result.source, 'app');
  } finally {
    useFontLister(null);
  }
});
