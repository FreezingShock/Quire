import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_SECTIONS, normalizeNavSections, sectionForFilter, toggleNavSection } from '../src/nav-sections.js';

test('the sidebar starts with Library and Notebooks open, and the rest folded', () => {
  assert.deepEqual(normalizeNavSections(undefined), { library: true, saved: true, notebooks: true, tags: false, mood: false, weather: false });
  assert.deepEqual(
    NAV_SECTIONS.map((section) => section.id),
    ['library', 'saved', 'notebooks', 'tags', 'mood', 'weather'],
  );
});

test('saved states win, and anything missing or not a yes/no takes its default', () => {
  const sections = normalizeNavSections({ library: false, tags: true, mood: 'yes' });
  assert.equal(sections.library, false);
  assert.equal(sections.tags, true);
  assert.equal(sections.mood, false, 'a non-boolean falls back to the default');
  assert.equal(sections.notebooks, true);
  assert.equal(sections.saved, true, 'saved searches start open');
  assert.equal(sections.weather, false);
});

test('toggleNavSection flips one section and returns a new object', () => {
  const before = normalizeNavSections({});
  const after = toggleNavSection(before, 'tags');
  assert.equal(after.tags, true);
  assert.equal(after.mood, false);
  assert.equal(before.tags, false, 'the old object is left alone');
});

test('a filter maps to the section that holds its rows', () => {
  assert.equal(sectionForFilter('notebook'), 'notebooks');
  assert.equal(sectionForFilter('tag'), 'tags');
  assert.equal(sectionForFilter('mood'), 'mood');
  assert.equal(sectionForFilter('weather'), 'weather');
  assert.equal(sectionForFilter('kind'), null);
  assert.equal(sectionForFilter('all'), null);
});
