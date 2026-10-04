import type { Editor } from '@tiptap/core';

// A freshly opened page shows a read-only preview for a moment while it joins the
// live session. A click and the typing right after it used to land nowhere: the
// preview cannot take a caret, and the live editor that replaced it mounted
// without focus, so every key went to the page body and was lost.
//
// So a click on the preview is remembered, keys typed until the editor is live are
// held, and the live editor takes the caret at the click and types them in.

export interface EarlyInput {
  x: number;
  y: number;
  text: string;
}

/** Cap on held text, so a stuck preview cannot grow a buffer without bound. */
export const EARLY_INPUT_MAX = 5000;

/** The held text after one key, or null when the key is not one we hold
 *  (arrows, shortcuts, Tab, Escape...). Pure. */
export function applyEarlyKey(text: string, key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}): string | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  if (key === 'Backspace') return text.slice(0, -1);
  if (key === 'Enter') return text.length < EARLY_INPUT_MAX ? text + '\n' : text;
  if (key.length !== 1) return null;
  return text.length < EARLY_INPUT_MAX ? text + key : text;
}

/** Whether a press on this element means "I want to write here": a text block in
 *  the preview or its empty space, not a widget inside it. */
export function isPreviewTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const preview = target.closest('.ProseMirror[contenteditable="false"]');
  if (!preview) return false;
  if (target === preview) return true;
  if (target.closest('[data-node-view-wrapper], [contenteditable="false"]:not(.ProseMirror), button, input, textarea, select, a')) return false;
  return !!target.closest('p, h1, h2, h3, li, blockquote');
}

/** Put the caret where the preview was clicked and type the held keys. */
export function replayEarlyInput(editor: Editor, early: EarlyInput): void {
  if (editor.isDestroyed) return;
  const at = editor.view.posAtCoords({ left: early.x, top: early.y })?.pos;
  editor.chain().focus(at ?? 'end').run();
  // The focus command moves the browser focus a frame later; a key landing in
  // that frame would go to the page body. Focus the view now as well.
  editor.view.focus();
  const lines = early.text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) editor.commands.enter();
    if (line) editor.commands.insertContent({ type: 'text', text: line });
  });
}
