// ---------------------------------------------------------------------------
// Selection menu, pure decisions for the editor's right-click menu. What the
// menu *does* (setLink, toggleMark, clipboard) lives in the component on
// editor.commands; this module only normalizes an href and decides which
// sections/items a given selection should offer, so it's testable without a
// live editor.
// ---------------------------------------------------------------------------

// Prepend https:// to a bare host, pass mailto:/tel:/anchors and already-schemed
// urls through, reject empty. Superset of linkMeta.normalizeUrl (which is
// http-only); kept here because the link input needs the extra schemes.
export function ensureHref(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (t.startsWith('#') || /^(mailto:|tel:)/i.test(t)) return t;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(t)) return t; // http://, https://, ftp://, …
  return `https://${t}`;
}

export type MenuItemId =
  | 'cut' | 'copy' | 'paste' | 'selectAll'
  | 'addLink' | 'editLink' | 'removeLink' | 'openLink'
  | 'bold' | 'italic' | 'code' | 'strike' | 'highlight' | 'clearFormat'
  | 'h1' | 'h2' | 'h3' | 'quote' | 'bulletList' | 'orderedList' | 'taskList' | 'codeBlock'
  | 'comment' | 'copyMarkdown' | 'subpage'
  | 'duplicateBlock' | 'deleteBlock';

export interface MenuSection {
  id: 'clipboard' | 'link' | 'format' | 'transform' | 'flair' | 'block';
  items: MenuItemId[];
}

// A small, serializable description of the selection. The component derives this
// from the editor; menuItemsFor branches on it.
export interface SelectionState {
  hasSelection: boolean; // a non-empty text range is selected
  inLink: boolean; // the selection/cursor sits inside a link mark
  onAtom: boolean; // an atom block is node-selected (table embed, image, poll…)
  isEmptyDoc: boolean; // the doc has no content worth acting on
}

export function menuItemsFor(state: SelectionState): MenuSection[] {
  // An atom block (image, table embed, poll…) has no text to format or
  // transform, offer clipboard + block actions instead.
  if (state.onAtom) {
    return [
      { id: 'clipboard', items: ['cut', 'copy', 'paste'] },
      { id: 'block', items: ['duplicateBlock', 'deleteBlock'] },
    ];
  }

  // Collapsed cursor: nothing is selected, so no link/format/transform, just
  // paste / select-all (insertion is left to the slash menu).
  if (!state.hasSelection) {
    return [{ id: 'clipboard', items: ['paste', 'selectAll'] }];
  }

  const link: MenuItemId[] = state.inLink ? ['editLink', 'removeLink', 'openLink'] : ['addLink'];
  return [
    { id: 'clipboard', items: ['cut', 'copy', 'paste'] },
    { id: 'link', items: link },
    { id: 'format', items: ['bold', 'italic', 'code', 'strike', 'highlight', 'clearFormat'] },
    { id: 'transform', items: ['h1', 'h2', 'h3', 'quote', 'bulletList', 'orderedList', 'taskList', 'codeBlock'] },
    { id: 'flair', items: ['comment', 'copyMarkdown', 'subpage'] },
  ];
}
