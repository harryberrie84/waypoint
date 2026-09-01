// Tiny OS helpers for showing the right modifier key in the UI. Mac uses the
// Command key (⌘); everything else uses Ctrl.

/** Is this a Mac or iOS device? False when there is no navigator (node, tests). */
export function isMac(): boolean {
  try {
    return /Mac|iPhone|iPad/.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/** Is this a desktop Linux? Android reports "Linux" in its user agent too and is
 *  NOT one, so it is excluded: a phone has no Ctrl key and no browser-quit
 *  shortcut, and treating it as Linux would move the label for no reason.
 *  Prefers userAgentData.platform, which is the un-spoofed value where engines
 *  ship it, and falls back to the string. */
export function isLinux(): boolean {
  try {
    const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    if (data?.platform) return data.platform === 'Linux';
    const ua = navigator.userAgent;
    return /Linux/.test(ua) && !/Android/.test(ua);
  } catch {
    return false;
  }
}

/** The command-modifier label for this OS: "⌘" on Mac/iOS, "Ctrl" elsewhere. */
export function modKey(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

/** The Undo shortcut label for this OS: "⌘Z" on Mac, "Ctrl+Z" elsewhere. */
export function undoHint(): string {
  return modKey() === '⌘' ? '⌘Z' : 'Ctrl+Z';
}

// --- Quick find -------------------------------------------------------------
// Q for query, EXCEPT where the browser owns it. The handler always accepts both
// Q and K; only the advertised label changes, so nobody is ever shown a shortcut
// that closes their browser:
//
//   Windows  Ctrl+Q   Chrome, Edge and Firefox all pass it through.
//   Linux    Ctrl+K   Firefox and Chromium QUIT on Ctrl+Q, and a page cannot
//                     cancel it, so advertising Q there is advertising data loss.
//   Mac      Cmd+K    macOS reserves Cmd+Q for quitting the application.
//
// Detection is a label decision only. Getting it wrong shows the other letter,
// which still works, rather than breaking anything.

/** The quick-find label for this OS. */
export function searchHint(): string {
  if (isMac()) return '⌘K';
  return isLinux() ? 'Ctrl+K' : 'Ctrl+Q';
}

/** Does this keydown open quick find? Q or K with the platform's command
 *  modifier. Both are accepted everywhere, whatever the label says, so a muscle
 *  memory carried between machines keeps working. Takes the platform as a
 *  parameter so both branches are testable off a Mac. */
export function isSearchShortcut(e: { metaKey: boolean; ctrlKey: boolean; key: string }, mac: boolean = isMac()): boolean {
  const key = (e.key || '').toLowerCase();
  if (key !== 'q' && key !== 'k') return false;
  return mac ? e.metaKey : e.ctrlKey;
}
