// ---------------------------------------------------------------------------
// Audio helpers. Pure so the test harness can reach them (scripts/tests.ts).
// ---------------------------------------------------------------------------

/**
 * Clock for a player, from a number of seconds: "0:07", "3:12", "1:04:09".
 * Anything not a finite number (a track whose metadata hasn't loaded yet, NaN,
 * Infinity) reads as "0:00" so the UI never shows "NaN:NaN".
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
