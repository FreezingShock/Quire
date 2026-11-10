/**
 * Version history rules. A version is a frozen copy of one entry's content at
 * one moment. This file decides when a copy is kept and what it holds. It has
 * no DOM and no storage, so the store and the UI both build on it.
 */

import { isBlankEntry, newId, normalizeEntry } from './model.js';

/** While you keep editing, an automatic version is kept at most this often. */
export const VERSION_INTERVAL_MS = 5 * 60 * 1000;
/** Per entry. The oldest versions beyond this count are dropped. */
export const MAX_VERSIONS = 30;

export const VERSION_REASONS = Object.freeze({
  auto: 'Autosave',
  manual: 'Saved by you',
  leave: 'Left the entry',
  restore: 'Before a restore',
});

export function describeReason(reason) {
  return VERSION_REASONS[reason] ?? 'Saved';
}

/**
 * The fields a version holds. Ids and timestamps stay with the entry, and sheet
 * height is derived from the ink, so neither is copied.
 */
export function contentOf(entry) {
  return {
    title: entry.title ?? '',
    date: entry.date,
    kind: entry.kind,
    tags: [...(entry.tags ?? [])],
    body: entry.body ?? '',
    pageColor: entry.pageColor,
    ink: { ops: entry.ink?.ops ?? [] },
  };
}

/** True when an entry's content matches a stored version's content. */
export function sameContent(entry, content) {
  return JSON.stringify(contentOf(entry)) === JSON.stringify(contentOf(content));
}

export function makeVersion(entry, reason, now = new Date()) {
  return { id: newId(), entryId: entry.id, savedAt: now.toISOString(), reason, content: contentOf(entry) };
}

/**
 * Whether a version of `entry` should be kept now. Nothing is kept for a blank
 * entry or when the content matches the latest version. Automatic versions also
 * wait VERSION_INTERVAL_MS after the latest one. For the first one, the wait
 * starts when the entry was created. Other reasons are kept whenever content changed.
 */
export function shouldKeepVersion({ entry, latest = null, reason, now = Date.now() }) {
  if (isBlankEntry(entry)) return false;
  if (latest && sameContent(entry, latest.content)) return false;
  if (reason !== 'auto') return true;
  const since = Date.parse(latest?.savedAt ?? entry.createdAt);
  return now - since >= VERSION_INTERVAL_MS;
}

/** Cleans a version read from a backup file. Returns null when it cannot belong to an entry. */
export function normalizeVersion(raw) {
  if (!raw || typeof raw.entryId !== 'string' || !raw.content || typeof raw.content !== 'object') return null;
  const content = contentOf(normalizeEntry({ ...raw.content, id: raw.entryId }));
  const savedAt = typeof raw.savedAt === 'string' && !Number.isNaN(Date.parse(raw.savedAt)) ? raw.savedAt : new Date().toISOString();
  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    entryId: raw.entryId,
    savedAt,
    reason: Object.hasOwn(VERSION_REASONS, raw.reason) ? raw.reason : 'auto',
    content,
  };
}
