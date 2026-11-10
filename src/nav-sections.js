/**
 * The collapsible sections of the library sidebar (the Library, Notebooks, Tags,
 * Mood and Weather lists). Pure, so the rules are unit tested. Which sections
 * are open is remembered in prefs.
 */

/** Section ids in sidebar order, with whether each starts open. */
export const NAV_SECTIONS = Object.freeze([
  { id: 'library', open: true },
  { id: 'saved', open: true },
  { id: 'notebooks', open: true },
  { id: 'places', open: true },
  { id: 'tags', open: false },
  { id: 'mood', open: false },
  { id: 'weather', open: false },
]);

/** The section that holds the rows a filter type picks from. Other filters live in Library. */
const FILTER_SECTION = Object.freeze({ notebook: 'notebooks', place: 'places', tag: 'tags', mood: 'mood', weather: 'weather' });

/** The section a filter's row lives in, so picking that row can open it. */
export function sectionForFilter(filterType) {
  return FILTER_SECTION[filterType] ?? null;
}

/** The open state of every section. Saved values win, anything unknown or missing takes its default. */
export function normalizeNavSections(saved) {
  const source = saved && typeof saved === 'object' ? saved : {};
  return Object.fromEntries(NAV_SECTIONS.map((section) => [section.id, typeof source[section.id] === 'boolean' ? source[section.id] : section.open]));
}

/** The sections with `id` flipped. Returns a new object. */
export function toggleNavSection(sections, id) {
  const current = normalizeNavSections(sections);
  return { ...current, [id]: !current[id] };
}
