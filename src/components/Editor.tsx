import { useEffect, useRef, useState } from 'react';
import { Pencil, ListChecks, Table } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import type { PageCollab } from '../lib/collab';
import { useAuth } from '../store/useAuth';
import { avatarColor } from '../lib/avatar';
import { cursorsEnabled } from '../lib/cursors';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import { TaskItemId } from '../editor/TaskItemId';
import { DeleteGuard } from '../editor/DeleteGuard';
import { ListEnter } from '../editor/ListEnter';
import { CodeHighlight } from '../editor/CodeHighlight';
import { CodeBlockWithCopy } from '../editor/CodeBlockView';
import { GithubCard } from '../editor/GithubCard';
import { parseGithubUrl } from '../lib/github';
import { SlashCommands } from '../editor/SlashCommands';
import { RowRef } from '../editor/RowRef';
import { PageLink } from '../editor/PageLink';
import { TableEmbed } from '../editor/TableEmbed';
import { ImageBlock } from '../editor/ImageBlock';
import { PlaceWidget } from '../editor/PlaceWidget';
import { WeatherBlock } from '../editor/WeatherBlock';
import { BookmarkBlock } from '../editor/BookmarkBlock';
import { CountdownBlock } from '../editor/CountdownBlock';
import { CustomCardBlock } from '../editor/CustomCardBlock';
import { SharedMapBlock } from '../editor/SharedMapBlock';
import { SharedTableBlock } from '../editor/SharedTableBlock';
import { VoteBlock } from '../editor/VoteBlock';
import { TierListBlock } from '../editor/TierListBlock';
import { CurrencyBlock } from '../editor/CurrencyBlock';
import { ReadinessBlock } from '../editor/ReadinessBlock';
import { ThisOrThatBlock } from '../editor/ThisOrThatBlock';
import { PackingBlock } from '../editor/PackingBlock';
import { ReservationBlock } from '../editor/ReservationBlock';
import { CompareBlock } from '../editor/CompareBlock';
import { SetlistBlock } from '../editor/SetlistBlock';
import { QuizBlock } from '../editor/QuizBlock';
import { EmbedBlock } from '../editor/EmbedBlock';
import { FileBlock } from '../editor/FileBlock';
import { AudioBlock } from '../editor/AudioBlock';
import { GalleryBlock } from '../editor/GalleryBlock';
import { BudgetSummary } from '../editor/BudgetSummary';
import { BudgetWidget } from '../editor/BudgetWidget';
import { MoneyDashboard } from '../editor/MoneyDashboard';
import { PollBlock } from '../editor/PollBlock';
import { FormBlock } from '../editor/FormBlock';
import { CharacterBlock } from '../editor/CharacterBlock';
import { CalloutCard } from '../editor/CalloutCard';
import { ChartBlock } from '../editor/ChartBlock';
import { ColumnList, Column as ColumnNode } from '../editor/Columns';
import { CaseBrief, Statute, Recipe } from '../editor/DocWidgets';
import { Mention, PageRef } from '../editor/InlineRefs';
import { TimerBlock } from '../editor/TimerBlock';
import { Toggle, ToggleSummary, ToggleContent } from '../editor/Toggle';
import { TableOfContents } from '../editor/TableOfContents';
import { MathBlock } from '../editor/MathBlock';
import { DiagramBlock } from '../editor/DiagramBlock';
import { SyncedBlock } from '../editor/SyncedBlock';
import { InlineComment, commentDecoKey } from '../editor/InlineComment';
import { InlineFormula } from '../editor/InlineFormula';
import { InlineCommentThread } from './InlineCommentThread';
import { commentsApi } from '../lib/api';
import { pb } from '../lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import { Highlight } from '../editor/Highlight';
import { SelectionMenu } from './SelectionMenu';
import { processImageFile, ImageTooLargeError, processAttachmentFile, FileTooLargeError } from '../lib/image';
import { uploadsApi } from '../lib/api';
import { parseForm, slugifyField } from '../lib/formBlock';
import { useData } from '../store/useData';
import { toast } from '../store/useToast';
import { markdownToTiptap } from '../lib/notionImport';
import { hasInlineMarkdown, parseInlineMarkdown } from '../lib/inlineMarkdown';
import { splitMarkdownTables } from '../lib/markdownTable';
import { parseLatLong, trackingChip } from '../lib/smartPaste';
import { attrText } from '../lib/search';
import { embedUrl } from '../editor/EmbedBlock';
import type { Column, CellValue, ColumnType } from '../types';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor as TiptapEditor } from '@tiptap/core';

type JSONBlock = { type: string; attrs?: Record<string, unknown>; content?: unknown[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

// Pasting plain multi-line text: ProseMirror flattens single newlines into
// spaces, so a block of commands or a snippet ends up on one line. Convert it
// ourselves: markdown (headings/lists/fences) through the markdown parser, a
// solid block of lines into a code block, and prose (paragraph breaks) into
// paragraphs that keep their line breaks. Returns true when it handled the paste.
function pasteRichText(editor: TiptapEditor, raw: string): boolean {
  const norm = raw.replace(/\r\n?/g, '\n');
  if (!norm.includes('\n')) {
    // Single line: only step in to apply inline markdown (**bold**, *italic*,
    // `code`, ~~strike~~, [a](b)); otherwise let the default plain paste run.
    if (!hasInlineMarkdown(norm)) return false;
    editor
      .chain()
      .focus()
      .insertContent(parseInlineMarkdown(norm) as never)
      .run();
    return true;
  }

  const looksMarkdown = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|)/.test(norm);
  let content: JSONBlock[];
  if (looksMarkdown) {
    content = (markdownToTiptap(norm) as { content?: JSONBlock[] }).content ?? [];
  } else if (!/\n\s*\n/.test(norm)) {
    // No blank lines: treat as a code/command block, preserving every line.
    content = [{ type: 'codeBlock', content: [{ type: 'text', text: norm.replace(/\n+$/, '') }] }];
  } else {
    content = norm.split(/\n{2,}/).map((p) => {
      const nodes: JSONBlock[] = [];
      p.split('\n').forEach((ln, i) => {
        if (i) nodes.push({ type: 'hardBreak' });
        if (ln) nodes.push(...parseInlineMarkdown(ln));
      });
      return nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' };
    });
  }
  if (!content.length) return false;
  editor.chain().focus().insertContent(content as never).run();
  return true;
}

// Insert an image node (data URL) into a ProseMirror view at a given position
// (or the current selection). Async-safe: bails if the view was torn down
// (e.g. the user navigated away before the image finished processing).
function insertImageIntoView(view: EditorView, src: string, pos?: number) {
  if (!view || (view as unknown as { isDestroyed?: boolean }).isDestroyed) return;
  const type = view.state.schema.nodes.image;
  if (!type) return;
  const node = type.create({ src });
  const tr =
    typeof pos === 'number'
      ? view.state.tr.insert(pos, node)
      : view.state.tr.replaceSelectionWith(node);
  view.dispatch(tr);
}

function handleImageFiles(view: EditorView, files: File[], pos?: number) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return false;
  void (async () => {
    for (const file of images) {
      try {
        // Prefer a real upload so the image keeps full resolution and the doc
        // stays small. Falls back to a downscaled inline data URL when the
        // uploads collection isn't set up.
        const url = await uploadsApi.upload(file);
        const src = url ?? (await processImageFile(file));
        insertImageIntoView(view, src, pos);
      } catch (err) {
        if (err instanceof ImageTooLargeError) toast(err.message, 'error');
        else console.error('[editor] image insert failed', err);
      }
    }
  })();
  return true;
}

// Drop any non-image file as a fileBlock attachment (boarding passes, PDFs…).
function insertFileBlockIntoView(view: EditorView, attrs: object, pos?: number) {
  if (!view || (view as unknown as { isDestroyed?: boolean }).isDestroyed) return;
  const type = view.state.schema.nodes.fileBlock;
  if (!type) return;
  const node = type.create(attrs);
  const tr =
    typeof pos === 'number' ? view.state.tr.insert(pos, node) : view.state.tr.replaceSelectionWith(node);
  view.dispatch(tr);
}

function handleAttachmentFiles(view: EditorView, files: File[], pos?: number) {
  const others = files.filter((f) => !f.type.startsWith('image/'));
  if (!others.length) return false;
  void (async () => {
    for (const file of others) {
      try {
        const a = await processAttachmentFile(file);
        insertFileBlockIntoView(view, a, pos);
      } catch (err) {
        if (err instanceof FileTooLargeError) toast(err.message, 'error');
        else console.error('[editor] file insert failed', err);
      }
    }
  })();
  return true;
}

// Drop a formBlock node bound to a (tableId, rowId) at the current selection.
function insertFormBlockIntoView(view: EditorView, attrs: object) {
  if (!view || (view as unknown as { isDestroyed?: boolean }).isDestroyed) return;
  const type = view.state.schema.nodes.formBlock;
  if (!type) return;
  view.dispatch(view.state.tr.replaceSelectionWith(type.create(attrs)));
}

// Coerce a pasted text value into a cell for the matching column type. Types we
// can't resolve purely from text (person/place ids, multiselect) are left for the
// user rather than guessed.
function coerceImport(col: Column, value: string): CellValue | undefined {
  switch (col.type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'checkbox':
      return value.toLowerCase() === 'true';
    case 'select': {
      const opt = (col.options ?? []).find((o) => o.label === value);
      return opt ? opt.id : undefined;
    }
    case 'text':
    case 'url':
    case 'date':
    case 'datetime':
      return value;
    default:
      return undefined;
  }
}

// Pasting a :::form[key]::: block fills (or creates) a matching form: find-or-
// create the key's table, add a row, map each line to a column by slug, and
// preserve any unknown field as a new text column so nothing is lost.
function importFormText(view: EditorView, text: string): boolean {
  const parsed = parseForm(text);
  if (!parsed) return false;
  void (async () => {
    const data = useData.getState();
    const tableId = await data.findOrCreateFormTable(parsed.key);
    if (!tableId) return;
    const rowId = await data.addRow(tableId);
    if (!rowId) return;
    for (const { slug, value } of parsed.values) {
      let col = (useData.getState().tables[tableId]?.columns ?? []).find((c) => slugifyField(c.name) === slug);
      if (!col) {
        data.addColumn(tableId, 'text' as ColumnType);
        const cols = useData.getState().tables[tableId]?.columns ?? [];
        col = cols[cols.length - 1];
        if (col) data.updateColumn(tableId, col.id, { name: slug });
      }
      if (!col) continue;
      const v = coerceImport(col, value);
      if (v !== undefined) data.setCell(rowId, col.id, v);
    }
    insertFormBlockIntoView(view, { tableId, rowId });
  })();
  return true;
}

// ---------------------------------------------------------------------------
// Editor, TipTap instance bound to a page's content.
// ---------------------------------------------------------------------------
// StarterKit already wires up the markdown input rules we need: "# " -> H1,
// "- " -> bullet, "1. " -> ordered, "> " -> quote, "``` " -> code block, plus
// bold/italic/code marks. TaskList/TaskItem add "[] " checkboxes. Our custom
// SlashCommands, RowRef, and TableEmbed extend it.
//
// onUpdate pushes JSON into the store, which debounces the network save (the
// "save on pause" model). When the page changes or a remote update arrives, we
// reconcile the editor content from the store WITHOUT clobbering an in-progress
// local edit (we only replace when the incoming doc differs from current).

interface EditorProps {
  content: object | null;
  editable: boolean;
  onChange: (json: object) => void;
  onFocusChange?: (focused: boolean) => void;
  // Text to scroll to and flash after opening from search. onFocusConsumed fires
  // once the editor has handled it (found or given up), so the store can clear it.
  focusText?: string;
  onFocusConsumed?: () => void;
  // The page this editor is on, for anchoring inline comments to the right page.
  pageId?: string;
  // When set, the editor binds to this shared Yjs document (real-time co-editing)
  // instead of the controlled `content` prop. `collabSeed` is true when the doc is
  // empty and should be seeded once from `content`.
  collab?: PageCollab | null;
  collabSeed?: boolean;
  // Restore a version: set this to the decrypted doc to replace the editor content.
  // Goes through the editor (not the content prop), so on a collab page it writes
  // into the shared Yjs doc and reaches every peer. onRestoreConsumed clears it.
  restore?: object | null;
  onRestoreConsumed?: () => void;
}

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

// A fixed Yjs client id used ONLY for the initial seed. Two clients first-opening
// the same fresh page seed identical content; giving that seed a constant client id
// makes the two Yjs updates byte-identical, so they merge to nothing (idempotent)
// instead of duplicating. Live edits use the doc's own random client id, so they
// never collide with each other or with the seed. Chosen large and fixed so a real
// (randomly generated) client id practically never equals it; a guard covers the
// astronomically-unlikely case anyway.
const SEED_CLIENT_ID = 424242;

// Find the doc position of `text` (in a text node or an atom widget's attrs),
// scroll its DOM into view and flash it. Returns true once it has handled it.
function scrollToText(editor: TiptapEditor, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos !== -1) return false;
    if (node.isText && node.text && node.text.toLowerCase().includes(needle)) {
      pos = p;
      return false;
    }
    if (node.isAtom && node.attrs && attrText(node.attrs).toLowerCase().includes(needle)) {
      pos = p;
      return false;
    }
    return true;
  });
  if (pos === -1) return false;
  try {
    const dom = (editor.view.nodeDOM(pos) as HTMLElement | null) ?? editor.view.domAtPos(pos).node;
    const el = (dom && dom.nodeType === 1 ? dom : (dom as Node | null)?.parentElement) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('search-flash');
      setTimeout(() => el.classList.remove('search-flash'), 1500);
      return true;
    }
  } catch {
    /* the position isn't in the DOM yet; caller retries when content settles */
  }
  return false;
}

export function Editor({ content, editable, onChange, onFocusChange, focusText, onFocusConsumed, pageId, collab, collabSeed, restore, onRestoreConsumed }: EditorProps) {
  // Who I am, for my collaboration caret (name + a stable colour from my id).
  const meUser = useAuth((s) => s.user);
  const meId = meUser?.id ?? '';
  const meName = meUser?.name || meUser?.email || 'Someone';
  const meColor = avatarColor(meId || meName);
  // Track the last content we set into the editor to avoid redundant resets
  // that would move the caret while typing.
  const lastSerialized = useRef<string>('');
  // Recently emitted docs. The save path is async (encrypt round-trips), so our
  // own edits echo back through `content` out of order; recognising any of them as
  // ours (not just the very last) stops a stale echo from being reapplied, which
  // was clearing text and jumping the caret mid-type.
  const emitted = useRef<string[]>([]);
  const remember = (s: string) => {
    const a = emitted.current;
    a.push(s);
    if (a.length > 60) a.shift();
  };
  // A remote doc that arrived while the editor was focused. Applying setContent
  // mid-edit resets the selection and drops the keystrokes sent since the echo
  // was in flight, so we stash the latest one and apply it on blur.
  const pendingRemote = useRef<object | null>(null);
  // The editor instance, for handlePaste (which only gets the PM view).
  const editorRef = useRef<TiptapEditor | null>(null);

  // Drives the empty-page nudge (the big "write a note / checklist / table"
  // buttons), kept in sync with the doc so it vanishes the moment there's content.
  const [empty, setEmpty] = useState(true);

  const editor = useEditor(
    {
      editable,
      onCreate: ({ editor }) => {
        setEmpty(editor.isEmpty);
        // First collaborative open of a page that already had content: seed the
        // shared doc once from the existing JSON. Do it on the very next tick (not
        // after a visible delay): connect() already replayed every relayed row,
        // including a peer's seed, before deciding this doc still needs one, so the
        // old 400ms wait added nothing but a half-second blank on reopen. The
        // isEmpty re-check still skips if a peer's seed lands first, and flushNow
        // relays ours at once. (A truly simultaneous double-seed is handled properly
        // by the deterministic-seed follow-up.)
        if (collab && collabSeed && content) {
          setTimeout(() => {
            if (editor.isDestroyed || !editor.isEmpty) return;
            // Seed under a fixed client id so parallel seeds of the same content are
            // identical Yjs updates (merge to nothing) rather than duplicates, then
            // restore the doc's own id for live edits. Fails safe: if this had no
            // effect it is just the old behaviour, never corruption.
            const ydoc = collab.doc as unknown as { clientID: number };
            const liveClientId = ydoc.clientID;
            if (liveClientId !== SEED_CLIENT_ID) ydoc.clientID = SEED_CLIENT_ID;
            try {
              editor.commands.setContent(content as object, { emitUpdate: true });
            } finally {
              ydoc.clientID = liveClientId;
            }
            collab.flushNow();
          }, 0);
        }
      },
      extensions: [
        StarterKit.configure({
          // Only h1–h3 are styled (index.css), so cap the input rules to match,
          // otherwise "#### " makes an unstyled heading.
          heading: { levels: [1, 2, 3] },
          // Replaced by CodeBlockWithCopy (adds a copy button + filename header).
          codeBlock: false,
          // StarterKit already bundles Link; configure it here rather than adding
          // a second copy (which throws). Auto-links typed and pasted URLs, wraps
          // a selected range on paste, opens in a new tab.
          link: {
            openOnClick: true,
            autolink: true,
            linkOnPaste: true,
            HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
          },
          // Yjs carries its own shared undo history when collaborating, so turn off
          // the built-in one to stop the two from fighting.
          ...(collab ? { undoRedo: false as const } : {}),
        }),
        ...(collab ? [Collaboration.configure({ document: collab.doc })] : []),
        // Live cursors: render each collaborator's caret + selection in their
        // colour, with their name. Reads/writes only the ephemeral awareness
        // (decorations), never the document, so it can't touch anyone's text.
        // The awareness is synced client-to-client over presence (usePresence).
        ...(collab && cursorsEnabled()
          ? [
              CollaborationCaret.configure({
                provider: { awareness: collab.awareness },
                user: { name: meName, color: meColor, id: meId },
              }),
            ]
          : []),
        Placeholder.configure({
          placeholder: "Write, or press '/' for commands…",
          // Mark empty paragraphs inside columns too, so the column hint shows.
          includeChildren: true,
        }),
        TaskList,
        TaskItemId,
        ListEnter,
        CodeBlockWithCopy,
        CodeHighlight,
        SlashCommands,
        RowRef,
        PageLink,
        TableEmbed,
        ImageBlock,
        PlaceWidget,
        WeatherBlock,
        BookmarkBlock,
        GithubCard,
        CountdownBlock,
        CustomCardBlock,
        SharedMapBlock,
        SharedTableBlock,
        VoteBlock,
        TierListBlock,
        CurrencyBlock,
        ReadinessBlock,
        ThisOrThatBlock,
        PackingBlock,
        ReservationBlock,
        CompareBlock,
        SetlistBlock,
        QuizBlock,
        EmbedBlock,
        FileBlock,
        AudioBlock,
        GalleryBlock,
        BudgetSummary,
        BudgetWidget,
        MoneyDashboard,
        PollBlock,
        FormBlock,
        CharacterBlock,
        CalloutCard,
        ChartBlock,
        ColumnList,
        ColumnNode,
        CaseBrief,
        Statute,
        Recipe,
        Mention,
        PageRef,
        InlineFormula,
        TimerBlock,
        Toggle,
        ToggleSummary,
        ToggleContent,
        TableOfContents,
        MathBlock,
        DiagramBlock,
        SyncedBlock,
        InlineComment,
        Highlight,
        DeleteGuard,
      ],
      // When collaborating, the Yjs document supplies the content; setting it here
      // would fight the binding. Seeding (if needed) happens in onCreate.
      content: collab ? undefined : ((content as object) ?? EMPTY_DOC),
      editorProps: {
        attributes: {
          class:
            'tiptap prose-editor min-h-[40vh] max-w-none focus:outline-none text-ink dark:text-coal-text',
        },
        // A link inside a contentEditable=false node view (a table cell, a widget)
        // is a REAL anchor: the browser navigates it natively. The link extension's
        // openOnClick plugin would ALSO window.open it, giving two tabs. This runs
        // before that plugin; returning true for such anchors lets only the native
        // navigation happen. Prose links (in editable text) fall through and the
        // link plugin opens them as before.
        handleClick: (_view, _pos, event) => {
          const a = (event.target as HTMLElement | null)?.closest?.('a');
          return !!(a && a.closest('[contenteditable="false"]'));
        },
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (text.includes(':::form[') && importFormText(view, text)) {
            event.preventDefault();
            return true;
          }
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.some((f) => f.type.startsWith('image/'))) {
            event.preventDefault();
            return handleImageFiles(view, files);
          }
          // A lone URL pasted into an empty selection becomes a card: an embed for a
          // known provider (YouTube, Spotify, Maps, Docs), a bookmark otherwise. With
          // a selection we leave it alone so it can turn the selected text into a link.
          const url = text.trim();
          if (editorRef.current && view.state.selection.empty && /^https?:\/\/\S+$/i.test(url) && !/\s/.test(url)) {
            // A GitHub repo / issue / PR link becomes a rich card with its state.
            if (parseGithubUrl(url)) {
              event.preventDefault();
              editorRef.current.chain().focus().insertContent({ type: 'githubCard', attrs: { url } }).run();
              return true;
            }
            const spec = embedUrl(url);
            const type = spec && spec.kind !== 'Embed' ? 'embedBlock' : 'bookmarkBlock';
            event.preventDefault();
            editorRef.current.chain().focus().insertContent({ type, attrs: { url } }).run();
            return true;
          }
          // A bare "lat,long" becomes a place; a UPS tracking number or ISBN becomes
          // a labelled link chip. Only into an empty selection.
          if (editorRef.current && view.state.selection.empty) {
            const geo = parseLatLong(text);
            if (geo) {
              event.preventDefault();
              editorRef.current.chain().focus().insertContent({ type: 'placeWidget', attrs: { lat: geo.lat, lon: geo.lon } }).run();
              return true;
            }
            const chip = !/\s/.test(text.trim()) ? trackingChip(text) : null;
            if (chip) {
              event.preventDefault();
              editorRef.current
                .chain()
                .focus()
                .insertContent([
                  { type: 'text', text: chip.label, marks: [{ type: 'link', attrs: { href: chip.href } }] },
                  { type: 'text', text: ' ' },
                ])
                .run();
              return true;
            }
          }
          // A pasted markdown / pipe table becomes a real table (Notion-style). Any
          // surrounding text is kept in order. Table creation is async, so the
          // inserts happen as each table is built.
          const blocks = editorRef.current ? splitMarkdownTables(text) : null;
          if (editorRef.current && blocks) {
            const ed = editorRef.current;
            event.preventDefault();
            void (async () => {
              for (const b of blocks) {
                if (b.type === 'table') {
                  const id = await useData.getState().createTableFromData('Table', b.table.headers, b.table.rows);
                  if (id) ed.chain().focus().insertContent({ type: 'tableEmbed', attrs: { tableId: id } }).run();
                } else {
                  pasteRichText(ed, b.text);
                }
              }
            })();
            return true;
          }
          // Keep multi-line text from collapsing onto one line.
          if (editorRef.current && pasteRichText(editorRef.current, text)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        handleDrop: (view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (!files.length) return false;
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          const hadImage = handleImageFiles(view, files, pos);
          const hadFile = handleAttachmentFiles(view, files, pos);
          if (hadImage || hadFile) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        const json = editor.getJSON();
        lastSerialized.current = JSON.stringify(json);
        remember(lastSerialized.current);
        setEmpty(editor.isEmpty);
        onChange(json);
      },
      onFocus: () => onFocusChange?.(true),
      onBlur: ({ editor }) => {
        onFocusChange?.(false);
        // Apply a remote update that landed while typing, now that focus is
        // gone, resetting the selection is harmless.
        const pending = pendingRemote.current;
        pendingRemote.current = null;
        if (!pending || editor.isDestroyed) return;
        const serialized = JSON.stringify(pending);
        if (serialized === lastSerialized.current) return;
        editor.commands.setContent(pending, { emitUpdate: false });
        lastSerialized.current = serialized;
      },
    },
    // No deps: we never recreate the editor in place. The parent remounts this
    // component via `key={pageId}` on navigation, so each page gets a fresh
    // editor cleanly. In-place recreation (the old `[pageId]` dep) raced with
    // this component's reconcile effect, which would then run against the
    // already-destroyed editor and throw on `editor.commands`.
    [],
  );
  editorRef.current = editor;

  // Reconcile remote/store content into the editor when it changes externally.
  useEffect(() => {
    // Bail if the editor is gone or already torn down. Without the isDestroyed
    // check, a stale-editor reference (e.g. during teardown) would throw when
    // we touch editor.commands below.
    if (!editor || editor.isDestroyed) return;
    // When collaborating, the Yjs binding owns the document; never setContent from
    // the store prop or we would clobber the shared doc.
    if (collab) return;
    const incoming = JSON.stringify(content ?? EMPTY_DOC);
    if (incoming === lastSerialized.current || emitted.current.includes(incoming)) {
      // Our own edit echoing back (possibly an out-of-order one), nothing remote
      // is outstanding. Never reapply it, that is what cleared text mid-type.
      lastSerialized.current = incoming;
      pendingRemote.current = null;
      return;
    }
    // Remote divergence. While the user is typing, never rewrite the doc:
    // setContent resets the selection and eats the characters typed since this
    // echo was sent. Stash it and apply on blur, so a viewer updates unless they
    // are mid-edit.
    if (editor.isFocused) {
      pendingRemote.current = (content ?? EMPTY_DOC) as object;
      return;
    }
    // Not focused (read-only viewers, other pages), apply immediately.
    editor.commands.setContent((content ?? EMPTY_DOC) as object, { emitUpdate: false });
    lastSerialized.current = incoming;
    pendingRemote.current = null;
    setEmpty(editor.isEmpty);
  }, [editor, content, collab]);

  // Restore a version: replace the doc through the editor so it works in both
  // modes. On a collab page setContent writes into the shared Yjs document, so the
  // restore reaches every peer and the encrypted snapshot; the onUpdate it emits
  // also saves the plaintext JSON as usual.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !restore) return;
    editor.commands.setContent(restore, { emitUpdate: true });
    onRestoreConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, restore]);

  // Keep editability in sync if it toggles.
  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editor, editable]);

  // Report "not focused" when this editor goes away. Destroying an editor does NOT
  // emit onBlur, so leaving the Notes tab with the caret in the body left the parent
  // believing you were still typing forever. PageView's decrypt effect skips while
  // that flag is set, so on an encrypted page every later content change went
  // undecrypted and the other tabs kept rendering a stale body: a file added in the
  // Files tab only appeared after a reload. Not mounted means not editing.
  useEffect(() => {
    return () => onFocusChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load inline-comment counts for this page (for the in-text badges) and keep
  // them fresh over SSE. A meta nudge rebuilds the badge decorations on change.
  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    let unsub: (() => void) | null = null;
    const recompute = async () => {
      try {
        const list = await commentsApi.listThreadsForPage(pageId);
        if (!alive) return;
        const counts: Record<string, number> = {};
        for (const c of list) counts[c.thread] = (counts[c.thread] ?? 0) + 1;
        useData.getState().setCommentCounts(counts);
        if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(commentDecoKey, true));
      } catch {
        /* counts stay as they were */
      }
    };
    void recompute();
    void pb
      .collection('comments')
      .subscribe('*', (e) => {
        const r = (e as { record: RecordModel }).record;
        if (r.page === pageId && r.thread) void recompute();
      })
      .then((fn) => {
        unsub = fn;
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (unsub) unsub();
    };
  }, [editor, pageId]);

  // Opened from a search hit: once the content is laid out, scroll to and flash
  // the matched text. Retries while the content (e.g. a decrypting page) settles;
  // gives up (and consumes) once the doc is non-empty but the text isn't found.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !focusText) return;
    const t = setTimeout(() => {
      if (editor.isDestroyed) return;
      const found = scrollToText(editor, focusText);
      if (found || !editor.isEmpty) onFocusConsumed?.();
    }, 90);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, focusText, content]);

  const addTable = () => {
    if (!editor) return;
    void useData
      .getState()
      .createTablePreset('grid')
      .then((tableId) => {
        if (tableId && !editor.isDestroyed) {
          editor.chain().focus().insertContent({ type: 'tableEmbed', attrs: { tableId } }).run();
        }
      });
  };

  return (
    <>
      <EditorContent editor={editor} />
      {editable && empty && editor && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => editor.chain().focus().run()}
            className="flex items-center gap-1.5 rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Pencil className="h-3.5 w-3.5" /> write a note
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            className="flex items-center gap-1.5 rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <ListChecks className="h-3.5 w-3.5" /> make a checklist
          </button>
          <button
            type="button"
            onClick={addTable}
            className="flex items-center gap-1.5 rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Table className="h-3.5 w-3.5" /> add a table
          </button>
        </div>
      )}
      <SelectionMenu editor={editor} />
      {pageId && <InlineCommentThread editor={editor} pageId={pageId} />}
    </>
  );
}
