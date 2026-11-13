/**
 * Desktop shell detection. The Tauri shell in src-tauri/ injects
 * `window.__QUIRE_DESKTOP__` before any page script runs. It is a frozen object:
 * `{ shell: 'tauri', version: '0.1.0', platform: 'windows' | 'macos' | 'linux' }`.
 * In the browser and the installed PWA the flag is absent, so every check here
 * gives the web answer. See docs/desktop.md for the full contract.
 */

export const DESKTOP_FLAG = '__QUIRE_DESKTOP__';

/** The shell's description, or null when Quire runs in a browser. */
export function desktopShell(scope = globalThis) {
  const info = scope?.[DESKTOP_FLAG];
  if (!info || typeof info !== 'object') return null;
  return Object.freeze({
    shell: String(info.shell ?? 'unknown'),
    version: String(info.version ?? ''),
    platform: String(info.platform ?? ''),
  });
}

export function isDesktop(scope = globalThis) {
  return desktopShell(scope) !== null;
}

/**
 * Calls a Tauri command or plugin command from page code, with no npm package.
 * Plugin commands use the form 'plugin:<name>|<command>'. Rejects outside the
 * desktop shell, so callers should check isDesktop() first.
 */
export function desktopInvoke(command, args = {}, scope = globalThis) {
  const internals = scope?.__TAURI_INTERNALS__;
  if (!isDesktop(scope) || typeof internals?.invoke !== 'function') {
    return Promise.reject(new Error('Not running in the Quire desktop shell.'));
  }
  return internals.invoke(command, args);
}

/** Sets `data-shell="desktop"` on <html> so CSS can adapt. Returns the shell description, or null. */
export function markDesktopShell(scope = globalThis) {
  const shell = desktopShell(scope);
  if (shell) scope.document?.documentElement?.setAttribute('data-shell', 'desktop');
  return shell;
}
