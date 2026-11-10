/**
 * Keeps the startup list in index.html and the offline list in sw.js in step
 * with the files the app ships. A new module that is missing from either list
 * fails here, instead of loading slowly or not at all offline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

const IMPORT = /(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]/g;

/** Every module reachable from src/main.js through static imports. Dynamic import() is left out on purpose: those load on demand. */
function startupGraph() {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of read(file).matchAll(IMPORT)) {
      const spec = match[1] ?? match[2];
      visit(normalize(join(dirname(file), spec)));
    }
  };
  visit('src/main.js');
  return seen;
}

function listFiles(dir, ext) {
  return readdirSync(join(ROOT, dir), { recursive: true })
    .filter((name) => name.endsWith(ext))
    .map((name) => `${dir}/${name}`.replaceAll('\\', '/'));
}

const indexHtml = read('index.html');
const stylesheets = [...indexHtml.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
const preloads = [...indexHtml.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);

const sw = read('sw.js');
const shellBlock = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
const precached = new Set([...shellBlock.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));

test('index.html preloads every module of the startup graph, and nothing else', () => {
  const expected = [...startupGraph()].filter((file) => file !== 'src/main.js').sort();
  assert.deepEqual([...preloads].sort(), expected, 'update the modulepreload links in index.html to match the imports from src/main.js');
});

test('the service worker precaches every module, stylesheet and page the app ships', () => {
  const required = [
    ...listFiles('src', '.js'),
    ...listFiles('styles', '.css'),
    ...stylesheets,
    'index.html',
    'manifest.webmanifest',
  ];
  const missing = [...new Set(required)].filter((file) => !precached.has(file));
  assert.deepEqual(missing, [], 'add these files to SHELL in sw.js so the first offline open works');
});

test('every precached file exists', () => {
  const gone = [...precached].filter((file) => {
    try {
      readFileSync(join(ROOT, file));
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(gone, [], 'remove these paths from SHELL in sw.js');
});
