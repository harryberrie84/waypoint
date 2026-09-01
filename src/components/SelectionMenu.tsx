import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Popover } from './Popover';
import { menuItemsFor, ensureHref, type MenuItemId, type SelectionState } from '../lib/selectionMenu';
import { useData } from '../store/useData';
import { uid } from '../lib/id';
import { isWidgetType } from '../lib/doc';
import { confirmDeleteRange } from '../editor/confirmDelete';
import {
  Scissors, Copy, ClipboardPaste, TextCursorInput, Link2, Link2Off, ExternalLink,
  Bold, Italic, Code, Strikethrough, Highlighter, RemoveFormatting,
  Heading1, Heading2, Heading3, Quote, List, ListOrdered, ListChecks, Code2,
  FileDown, FilePlus2, CopyPlus, Trash2, MessageSquarePlus, type LucideIcon,
} from 'lucide-react';

// SelectionMenu, the editor's right-click menu. Reuses Popover (portal, flip,
// clamp, click-outside) anchored to a 1px element at the pointer. Pure logic
// (which items to show, href normalization) lives in lib/selectionMenu; here we
// derive the selection state and forward each item to editor.commands / the
// clipboard. Paste is dispatched as a real paste event so the editor's existing
// handlePaste (image + form import) still runs, we never reimplement it.

const META: Record<MenuItemId, { icon: LucideIcon; label: string }> = {
  cut: { icon: Scissors, label: 'Cut' },
  copy: { icon: Copy, label: 'Copy' },
  paste: { icon: ClipboardPaste, label: 'Paste' },
  selectAll: { icon: TextCursorInput, label: 'Select all' },
  addLink: { icon: Link2, label: 'Add link' },
  editLink: { icon: Link2, label: 'Edit link' },
  removeLink: { icon: Link2Off, label: 'Remove link' },
  openLink: { icon: ExternalLink, label: 'Open link' },
  bold: { icon: Bold, label: 'Bold' },
  italic: { icon: Italic, label: 'Italic' },
  code: { icon: Code, label: 'Code' },
  strike: { icon: Strikethrough, label: 'Strikethrough' },
  highlight: { icon: Highlighter, label: 'Highlight' },
  clearFormat: { icon: RemoveFormatting, label: 'Clear formatting' },
  h1: { icon: Heading1, label: 'Heading 1' },
  h2: { icon: Heading2, label: 'Heading 2' },
  h3: { icon: Heading3, label: 'Heading 3' },
  quote: { icon: Quote, label: 'Quote' },
  bulletList: { icon: List, label: 'Bulleted list' },
  orderedList: { icon: ListOrdered, label: 'Numbered list' },
  taskList: { icon: ListChecks, label: 'To-do list' },
  codeBlock: { icon: Code2, label: 'Code block' },
  comment: { icon: MessageSquarePlus, label: 'Comment' },
  copyMarkdown: { icon: FileDown, label: 'Copy as markdown' },
  subpage: { icon: FilePlus2, label: 'New sub-page' },
  duplicateBlock: { icon: CopyPlus, label: 'Duplicate' },
  deleteBlock: { icon: Trash2, label: 'Delete' },
};

// The mark each format item toggles, so the menu can reflect the active state.
const FORMAT_MARK: Partial<Record<MenuItemId, string>> = {
  bold: 'bold', italic: 'italic', code: 'code', strike: 'strike', highlight: 'highlight',
};

// A few highlight swatches, read the theme tokens so they track a custom theme.
const HL_SWATCHES = ['var(--clay)', 'var(--ochre-soft)', 'rgb(110 190 130)', 'rgb(110 170 240)'];

export function SelectionMenu({ editor }: { editor: Editor | null }) {
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<SelectionState | null>(null);
  const [view, setView] = useState<'menu' | 'link' | 'highlight'>('menu');
  const [href, setHref] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const createPage = useData((s) => s.createPage);

  const close = useCallback(() => {
    setPt(null);
    setHint(null);
  }, []);

  // contextmenu on the editor DOM. Over a form control (table cell, poll, form,
  // place search) we leave the native menu alone, those widgets own their
  // editing. Otherwise we suppress it and open ours.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, button, [contenteditable="false"] [role="button"]')) return;

      // If the click landed on an atom node view (image, table embed…), select
      // it so the menu offers block actions rather than text formatting.
      const wrapper = target.closest('[data-node-view-wrapper]');
      if (wrapper) {
        try {
          const inside = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.inside ?? -1;
          if (inside >= 0) {
            const tr = editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, inside));
            editor.view.dispatch(tr);
          }
        } catch {
          // not node-selectable, fall through to whatever selection exists
        }
      }

      e.preventDefault();
      const sel = editor.state.selection;
      const isNode = sel instanceof NodeSelection;
      const next: SelectionState = {
        hasSelection: !sel.empty && !isNode,
        inLink: editor.isActive('link'),
        onAtom: isNode && sel.node.isAtom,
        isEmptyDoc: editor.state.doc.textContent.trim() === '' && editor.state.doc.childCount <= 1,
      };
      setState(next);
      setHref(editor.getAttributes('link').href ?? '');
      setView('menu');
      setHint(null);
      setPt({ x: e.clientX, y: e.clientY });
    };
    dom.addEventListener('contextmenu', onCtx);
    return () => dom.removeEventListener('contextmenu', onCtx);
  }, [editor]);

  // Escape closes.
  useEffect(() => {
    if (!pt) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pt, close]);

  if (!editor || !pt || !state) return null;

  const chain = () => editor.chain().focus();

  // Dispatch a real paste event so the editor's handlePaste (image + form
  // import) runs. Clipboard read can be blocked, then we hint at the shortcut.
  const doPaste = async () => {
    try {
      const dt = new DataTransfer();
      let any = false;
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            const blob = await item.getType(type);
            if (type.startsWith('image/')) dt.items.add(new File([blob], 'pasted', { type }));
            else dt.setData(type, await blob.text());
            any = true;
          }
        }
      } else if (navigator.clipboard?.readText) {
        dt.setData('text/plain', await navigator.clipboard.readText());
        any = true;
      }
      if (!any) throw new Error('empty');
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(ev);
      close();
    } catch {
      setHint('clipboard blocked, paste with ⌘/Ctrl+V');
    }
  };

  // copy/cut via the browser so the editor's own clipboard serializer runs
  // (keeps formatting). execCommand is deprecated but is the simplest path that
  // routes through ProseMirror's copy handling for the live selection.
  const clip = (cmd: 'copy' | 'cut') => {
    editor.view.focus();
    try {
      const ok = document.execCommand(cmd);
      if (!ok) throw new Error('denied');
      close();
    } catch {
      setHint(`clipboard blocked, use ⌘/Ctrl+${cmd === 'cut' ? 'X' : 'C'}`);
    }
  };

  const submitLink = () => {
    const url = ensureHref(href);
    if (!url) {
      chain().extendMarkRange('link').unsetLink().run();
    } else {
      chain().extendMarkRange('link').setLink({ href: url }).run();
    }
    close();
  };

  const newComment = () => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      close();
      return;
    }
    const threadId = uid('cmt');
    chain().setMark('inlineComment', { threadId }).run();
    const coords = editor.view.coordsAtPos(to);
    useData.getState().openCommentThread(threadId, coords.bottom, coords.left);
    close();
  };

  const newSubpage = () => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, '\n').trim();
    const parent = useData.getState().activePageId ?? '';
    void createPage(parent, false).then(async (id) => {
      if (!id) return;
      if (text) {
        const ok = await useData
          .getState()
          .seedPageContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
        // The seed did not land (locked vault in an encrypted workspace). Keep the
        // selection where it is: deleting it now would destroy the only copy.
        if (!ok) return;
      }
      chain().deleteSelection().insertContent({ type: 'pageLink', attrs: { pageId: id } }).run();
    });
    close();
  };

  const run = (id: MenuItemId) => {
    switch (id) {
      case 'cut': clip('cut'); break;
      case 'copy': clip('copy'); break;
      case 'paste': void doPaste(); break;
      case 'selectAll': chain().selectAll().run(); close(); break;
      case 'addLink': case 'editLink': setView('link'); break;
      case 'removeLink': chain().extendMarkRange('link').unsetLink().run(); close(); break;
      case 'openLink': { const h = editor.getAttributes('link').href; if (h) window.open(h, '_blank', 'noopener'); close(); break; }
      case 'bold': chain().toggleBold().run(); close(); break;
      case 'italic': chain().toggleItalic().run(); close(); break;
      case 'code': chain().toggleCode().run(); close(); break;
      case 'strike': chain().toggleStrike().run(); close(); break;
      case 'highlight': setView('highlight'); break;
      case 'clearFormat': chain().unsetAllMarks().run(); close(); break;
      case 'h1': chain().setNode('heading', { level: 1 }).run(); close(); break;
      case 'h2': chain().setNode('heading', { level: 2 }).run(); close(); break;
      case 'h3': chain().setNode('heading', { level: 3 }).run(); close(); break;
      case 'quote': chain().toggleBlockquote().run(); close(); break;
      case 'bulletList': chain().toggleBulletList().run(); close(); break;
      case 'orderedList': chain().toggleOrderedList().run(); close(); break;
      case 'taskList': chain().toggleTaskList().run(); close(); break;
      case 'codeBlock': chain().toggleCodeBlock().run(); close(); break;
      case 'comment': newComment(); break;
      case 'copyMarkdown': void copyAsMarkdown(editor).then((ok) => (ok ? close() : setHint('clipboard blocked'))); break;
      case 'subpage': newSubpage(); break;
      case 'duplicateBlock': {
        const sel = editor.state.selection;
        if (sel instanceof NodeSelection) chain().insertContentAt(sel.to, sel.node.toJSON()).run();
        close();
        break;
      }
      case 'deleteBlock': {
        // A selected WIDGET block goes through the same confirm + Undo toast as
        // the keyboard delete; plain text/blocks delete directly as before.
        const sel = editor.state.selection;
        if (sel instanceof NodeSelection && sel.node.isBlock && isWidgetType(sel.node.type.name)) {
          close();
          confirmDeleteRange(editor, sel.from, sel.to, [{ type: sel.node.type.name, tableId: sel.node.attrs.tableId as string | undefined }]);
        } else {
          chain().deleteSelection().run();
          close();
        }
        break;
      }
    }
  };

  const sections = menuItemsFor(state);

  return (
    <>
      <div ref={anchorRef} style={{ position: 'fixed', left: pt.x, top: pt.y, width: 1, height: 1 }} aria-hidden />
      <Popover open onClose={close} anchorRef={anchorRef} width={view === 'menu' ? 220 : 260}>
        {view === 'link' ? (
          <div className="p-1.5">
            <input
              autoFocus
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitLink(); if (e.key === 'Escape') setView('menu'); }}
              placeholder="paste or type a url"
              className="w-full rounded-md border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <button type="button" onClick={() => setView('menu')} className="rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line">back</button>
              <button type="button" onClick={submitLink} className="rounded-md bg-clay px-2.5 py-1 text-xs font-medium text-white hover:bg-clay-soft">apply</button>
            </div>
          </div>
        ) : view === 'highlight' ? (
          <div className="p-1.5">
            <div className="flex items-center gap-1.5">
              {HL_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { chain().setHighlight({ color: c }).run(); close(); }}
                  className="h-6 w-6 rounded-md border border-paper-line dark:border-coal-line"
                  style={{ background: c }}
                  title="highlight"
                />
              ))}
              <button
                type="button"
                onClick={() => { chain().unsetHighlight().run(); close(); }}
                className="ml-auto rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
              >
                clear
              </button>
            </div>
          </div>
        ) : (
          <>
            {sections.map((section, i) => (
              <div key={section.id} className={i > 0 ? 'mt-1 border-t border-paper-line pt-1 dark:border-coal-line' : ''}>
                {section.items.map((id) => {
                  const { icon: Icon, label } = META[id];
                  const mark = FORMAT_MARK[id];
                  const active = mark ? editor.isActive(mark) : false;
                  const danger = id === 'deleteBlock';
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => run(id)}
                      className={[
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        danger
                          ? 'text-ink hover:bg-red-50 hover:text-red-600 dark:text-coal-text dark:hover:bg-red-500/10'
                          : active
                            ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
                            : 'text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line',
                      ].join(' ')}
                    >
                      <Icon className={['h-4 w-4 shrink-0', active ? 'text-clay dark:text-clay-soft' : 'text-ink-faint dark:text-coal-soft'].join(' ')} />
                      {label}
                    </button>
                  );
                })}
              </div>
            ))}
            {hint && <p className="px-2 py-1.5 text-[11px] text-ink-faint dark:text-coal-soft">{hint}</p>}
          </>
        )}
      </Popover>
    </>
  );
}

// Compact markdown of the current selection, covers the everyday blocks/marks;
// anything unhandled falls back to its plain text. Returns true if it wrote.
async function copyAsMarkdown(editor: Editor): Promise<boolean> {
  const { from, to } = editor.state.selection;
  const slice = editor.state.doc.slice(from, to);
  const blocks: string[] = [];
  slice.content.forEach((node) => blocks.push(blockToMd(node)));
  const md = blocks.join('\n\n').trim();
  try {
    await navigator.clipboard.writeText(md);
    return true;
  } catch {
    return false;
  }
}

// Minimal ProseMirror-node → markdown. Uses PM's own Node type (no `any`).
function inlineToMd(node: PMNode): string {
  if (node.text === undefined) return node.textContent;
  let t = node.text;
  for (const m of node.marks) {
    if (m.type.name === 'bold') t = `**${t}**`;
    else if (m.type.name === 'italic') t = `*${t}*`;
    else if (m.type.name === 'code') t = `\`${t}\``;
    else if (m.type.name === 'strike') t = `~~${t}~~`;
    else if (m.type.name === 'link') t = `[${t}](${String(m.attrs.href ?? '')})`;
  }
  return t;
}

function inlineRun(node: PMNode): string {
  let out = '';
  node.content.forEach((child) => (out += inlineToMd(child)));
  return out || node.textContent;
}

function blockToMd(node: PMNode): string {
  const name = node.type.name;
  if (name === 'heading') return `${'#'.repeat(Number(node.attrs.level ?? 1))} ${inlineRun(node)}`;
  if (name === 'blockquote') return `> ${node.textContent}`;
  if (name === 'codeBlock') return `\`\`\`\n${node.textContent}\n\`\`\``;
  if (name === 'bulletList' || name === 'orderedList') {
    const lines: string[] = [];
    let n = 1;
    node.content.forEach((item) => {
      const bullet = name === 'orderedList' ? `${n++}.` : '-';
      lines.push(`${bullet} ${item.textContent}`);
    });
    return lines.join('\n');
  }
  return inlineRun(node);
}
