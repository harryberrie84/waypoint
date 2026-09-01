// Kill switch for live collaboration cursors, matching waypoint:nocollab /
// waypoint:nolocal. If the caret or awareness transport ever misbehaves, run
//   localStorage.setItem('waypoint:nocursors', '1')
// in the browser console and reload: the caret extension isn't added and no
// cursor is broadcast or applied, while editing/sync carry on exactly as before.
export function cursorsEnabled(): boolean {
  try {
    return localStorage.getItem('waypoint:nocursors') !== '1';
  } catch {
    return true; // private-mode storage; default on
  }
}
