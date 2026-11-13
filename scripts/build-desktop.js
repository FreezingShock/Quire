/**
 * Copies the web app into dist-desktop/, the folder the Tauri shell bundles into
 * the installer. Only the files the page loads are copied. Tests, end-to-end
 * specs, the service worker and dev tooling stay out of the binary.
 * Usage: `npm run desktop:web`. The web app itself is unchanged.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

/** Everything the page needs at runtime. Keep in step with index.html and src/. */
export const DESKTOP_ENTRIES = ['index.html', 'manifest.webmanifest', 'src', 'styles', 'assets'];

export async function buildDesktop({
  root = fileURLToPath(new URL('..', import.meta.url)),
  out = join(root, 'dist-desktop'),
} = {}) {
  const from = resolve(root);
  const to = resolve(out);
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  for (const entry of DESKTOP_ENTRIES) {
    await cp(join(from, entry), join(to, entry), { recursive: true });
  }
  return to;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildDesktop();
  console.log(`Desktop web files written to ${out}`);
}
