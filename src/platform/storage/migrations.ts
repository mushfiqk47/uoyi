/** Runs a migration once and records it. A migration that throws does not leave its flag
 *  behind, so the next load retries instead of silently skipping the fix. */
export function once(key: string, run: () => void): boolean {
  try {
    if (localStorage.getItem(key)) return false;
  } catch {
    // Storage is unavailable (private mode); the caller still needs its defaults.
    return false;
  }
  run();
  try {
    localStorage.setItem(key, "1");
  } catch {
    // The migration may run again next load; it is written to be idempotent.
  }
  return true;
}
