/**
 * Named marks on the performance timeline for startup and navigation. The perf
 * checks in the e2e suite read them, so a slow step shows up as a number.
 */
export function mark(name) {
  try {
    globalThis.performance?.mark?.(name);
  } catch {
    // Marks are best-effort: a browser without the User Timing API just skips them.
  }
}
