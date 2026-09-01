import { useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Music2, Mic2, Clock, Plus, Trash2, Check, GripVertical, Download, Upload, FileDown, Copy, Printer } from 'lucide-react';
import { uid } from '../lib/id';
import { type SetItem, type SetKind, serializeSetlist, parseSetlist, SETLIST_TEMPLATE } from '../lib/setlistIO';
import { buildSetlistHtml } from '../lib/widgetExport';
import { printHtml } from '../lib/printDoc';
import { WidgetShare } from './WidgetShare';
import { toast } from '../store/useToast';

// setlistBlock, a running order for a gig. Three kinds of line, so it is more than
// a table: a numbered SONG (title, who/key, minutes), a SAY line (the bit you say
// between songs), and a SEGMENT band (a labelled divider, e.g. "Intro quiz"). Every
// line can carry minutes, summed into a running time. Drag the handle to reorder.
// Import / export / blank template round-trip through lib/setlistIO (plain text).
// Searchable text lives in each item's `text` field (lib/search.ts reads it).

function fmtTotal(mins: number): string {
  if (mins <= 0) return '0 min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const KIND_LABEL: Record<SetKind, string> = { song: 'Song', banter: 'Say', segment: 'Segment' };
const DEFAULT_MINS: Record<SetKind, number> = { song: 4, banter: 1, segment: 5 };

function SetlistView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const items: SetItem[] = Array.isArray(node.attrs.items) ? (node.attrs.items as SetItem[]) : [];
  const title = (node.attrs.title as string) || '';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');

  const write = (next: SetItem[]) => updateAttributes({ items: next });
  const patch = (id: string, p: Partial<SetItem>) => write(items.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const remove = (id: string) => {
    write(items.filter((it) => it.id !== id));
    setEditingId(null);
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = items.findIndex((it) => it.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    write(next);
  };
  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = items.findIndex((it) => it.id === fromId);
    const to = items.findIndex((it) => it.id === toId);
    if (from < 0 || to < 0) return;
    const next = items.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    write(next);
  };

  // Reorder via Pointer Events so it works with a mouse, a finger, or a pen. The
  // old path used HTML5 drag-and-drop, which never fires on a touchscreen (mobile
  // or a desktop tablet), so the grip handle did nothing there. We track the pointer
  // on the window (not the handle) so a mid-drag re-render can't drop the gesture,
  // and `touch-none` on the handle stops the page scrolling while you drag.
  const rowUnder = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest('[data-setitem]')?.getAttribute('data-setitem') || null;
  };
  const startDrag = (id: string) => (e: React.PointerEvent) => {
    if (!editable) return;
    e.preventDefault();
    dragRef.current = id;
    setDragId(id);
    setOverId(id);
    const onMove = (ev: PointerEvent) => {
      const over = rowUnder(ev.clientX, ev.clientY);
      if (over) setOverId(over);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const from = dragRef.current;
      const to = rowUnder(ev.clientX, ev.clientY);
      dragRef.current = null;
      setDragId(null);
      setOverId(null);
      if (from && to) reorder(from, to);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  const add = (kind: SetKind) => {
    const it: SetItem = { id: uid(), kind, text: '', sub: kind === 'song' ? '' : undefined, mins: DEFAULT_MINS[kind] };
    write([...items, it]);
    setEditingId(it.id);
  };

  const doExport = () => downloadText(`${(title || 'setlist').replace(/[^\w-]+/g, '_')}.txt`, serializeSetlist(title, items));
  const doPdf = () => printHtml(buildSetlistHtml(title, items));
  const doCopy = () => {
    void navigator.clipboard?.writeText(serializeSetlist(title, items));
    toast('Setlist copied');
  };
  const doImport = () => {
    const parsed = parseSetlist(importText);
    if (parsed.items.length === 0) {
      toast('Nothing to import, check the format', 'error');
      return;
    }
    updateAttributes({ title: parsed.title || title, items: parsed.items.map((it) => ({ ...it, id: uid() })) });
    setImporting(false);
    setImportText('');
    toast(`Imported ${parsed.items.length} lines`);
  };

  const total = items.reduce((s, it) => s + (typeof it.mins === 'number' ? it.mins : 0), 0);
  let songNo = 0;

  // Shared drop-target wiring for a display row: an id the pointer sweep can find,
  // plus a highlight when the dragged line is hovering over this one.
  const dragProps = (id: string) => (editable ? { 'data-setitem': id } : {});
  const overCls = (id: string) => (editable && dragId && overId === id && dragId !== id ? 'ring-2 ring-inset ring-clay' : '');
  const Handle = ({ id, light }: { id: string; light?: boolean }) =>
    editable ? (
      <span
        onPointerDown={startDrag(id)}
        className={`shrink-0 touch-none cursor-grab select-none active:cursor-grabbing ${light ? 'text-white/70' : 'text-ink-faint/60 dark:text-coal-soft/60'}`}
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </span>
    ) : null;
  const Mins = ({ it, light }: { it: SetItem; light?: boolean }) =>
    typeof it.mins === 'number' && it.mins > 0 ? (
      <span className={`ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums ${light ? 'text-white/80' : 'text-ink-faint dark:text-coal-soft'}`}>{it.mins} min</span>
    ) : null;

  const iconBtn = 'rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line';

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-2xl border border-paper-line bg-paper-panel/30 dark:border-coal-line dark:bg-coal/30">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-paper-line bg-gradient-to-r from-clay-wash/70 to-transparent px-4 py-3 dark:border-coal-line dark:from-clay/10">
          <Music2 className="h-5 w-5 shrink-0 text-clay" />
          {editable ? (
            <input
              value={title}
              onChange={(e) => updateAttributes({ title: e.target.value })}
              placeholder="Set name (e.g. Friday night set)"
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
            />
          ) : (
            <div className="min-w-0 flex-1 truncate text-lg font-semibold text-ink dark:text-coal-text">{title || 'Setlist'}</div>
          )}
          <span className="flex items-center gap-1 whitespace-nowrap text-xs text-ink-soft dark:text-coal-soft">
            <Clock className="h-3.5 w-3.5" /> {fmtTotal(total)} · {items.filter((i) => i.kind === 'song').length} songs
          </span>
          <button type="button" onClick={doPdf} className={iconBtn} title="Export a styled PDF (Save as PDF)">
            <Printer className="h-4 w-4" />
          </button>
          {editable && (
            <WidgetShare
              attrs={node.attrs}
              updateAttributes={updateAttributes}
              title={title || 'Setlist'}
              label="setlist"
              docOf={() => ({ type: 'doc', content: [{ type: 'setlistBlock', attrs: { title, items } }] })}
            />
          )}
          {editable && (
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={doExport} className={iconBtn} title="Export to a .txt file">
                <Download className="h-4 w-4" />
              </button>
              <button type="button" onClick={doCopy} className={iconBtn} title="Copy as text">
                <Copy className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => downloadText('setlist-template.txt', SETLIST_TEMPLATE)} className={iconBtn} title="Download a blank template">
                <FileDown className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setImporting((v) => !v)} className={iconBtn} title="Import from text">
                <Upload className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {editable && importing && (
          <div className="space-y-2 border-b border-paper-line bg-paper/60 p-3 dark:border-coal-line dark:bg-coal/40">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={5}
              placeholder={`Paste a setlist, one line each:\n\nsong | title | who/key | minutes\nsay | what you say | minutes\nsegment | label | minutes`}
              className="w-full resize-none rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
            />
            <div className="flex items-center gap-2">
              <button type="button" onClick={doImport} className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90">
                Load
              </button>
              <button type="button" onClick={() => setImporting(false)} className="text-sm text-ink-faint hover:text-ink dark:text-coal-soft">
                Cancel
              </button>
              <span className="ml-auto text-[10px] text-ink-faint dark:text-coal-soft">replaces the list below</span>
            </div>
          </div>
        )}

        <div className="divide-y divide-paper-line/70 dark:divide-coal-line/70">
          {items.map((it) => {
            if (it.kind === 'song') songNo += 1;
            const myNo = it.kind === 'song' ? songNo : 0;
            const faded = dragId === it.id ? 'opacity-40' : '';

            if (editingId === it.id && editable) {
              return (
                <div key={it.id} className="space-y-2 bg-paper/60 p-3 dark:bg-coal/40">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={it.kind}
                      onChange={(e) => patch(it.id, { kind: e.target.value as SetKind })}
                      className="rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                    >
                      <option value="song">Song</option>
                      <option value="banter">Say (between songs)</option>
                      <option value="segment">Segment</option>
                    </select>
                    <input
                      value={it.text}
                      onChange={(e) => patch(it.id, { text: e.target.value })}
                      placeholder={it.kind === 'song' ? 'Song title' : it.kind === 'banter' ? 'What you say between songs' : 'Segment label (e.g. Intro quiz)'}
                      className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                    />
                  </div>
                  {it.kind === 'song' && (
                    <input
                      value={it.sub ?? ''}
                      onChange={(e) => patch(it.id, { sub: e.target.value })}
                      placeholder="artist / key / who leads"
                      className="w-full rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink-soft outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-ink-faint dark:text-coal-soft">
                      <input
                        type="number"
                        min={0}
                        value={it.mins ?? ''}
                        onChange={(e) => patch(it.id, { mins: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                        className="w-16 rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                      />
                      min
                    </label>
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" onClick={() => move(it.id, -1)} className={iconBtn} title="Move up">↑</button>
                      <button type="button" onClick={() => move(it.id, 1)} className={iconBtn} title="Move down">↓</button>
                      <button type="button" onClick={() => remove(it.id)} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-rose-500 dark:hover:bg-coal-line" title="Remove">
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="flex items-center gap-1 rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90">
                        <Check className="h-3.5 w-3.5" /> Done
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            const open = editable ? () => setEditingId(it.id) : undefined;

            if (it.kind === 'segment') {
              return (
                <div key={it.id} {...dragProps(it.id)} className={`flex items-center gap-2 bg-clay/90 px-3 py-2.5 text-white ${faded} ${overCls(it.id)}`}>
                  <Handle id={it.id} light />
                  <button type="button" onClick={open} className={`min-w-0 flex-1 text-left text-sm font-semibold uppercase tracking-wide ${editable ? 'cursor-pointer' : 'cursor-default'}`}>
                    {it.text || 'Segment'}
                  </button>
                  <Mins it={it} light />
                </div>
              );
            }
            if (it.kind === 'banter') {
              return (
                <div key={it.id} {...dragProps(it.id)} className={`flex items-center gap-2 border-l-2 border-dashed border-clay/50 bg-paper/40 px-3 py-2 dark:bg-coal/20 ${faded} ${overCls(it.id)}`}>
                  <Handle id={it.id} />
                  <Mic2 className="h-3.5 w-3.5 shrink-0 text-clay" />
                  <button type="button" onClick={open} className={`min-w-0 flex-1 text-left text-sm italic text-ink-soft dark:text-coal-soft ${editable ? 'cursor-pointer' : 'cursor-default'}`}>
                    {it.text || 'what you say between songs…'}
                  </button>
                  <Mins it={it} />
                </div>
              );
            }
            // song
            return (
              <div key={it.id} {...dragProps(it.id)} className={`flex items-center gap-2 px-3 py-2.5 ${faded} ${overCls(it.id)}`}>
                <Handle id={it.id} />
                <button type="button" onClick={open} className={`flex min-w-0 flex-1 items-center gap-3 text-left ${editable ? 'cursor-pointer' : 'cursor-default'}`}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay-wash text-xs font-bold tabular-nums text-clay dark:bg-clay/20 dark:text-clay-soft">{myNo}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink dark:text-coal-text">{it.text || 'Untitled song'}</span>
                    {it.sub && <span className="block truncate text-xs text-ink-faint dark:text-coal-soft">{it.sub}</span>}
                  </span>
                </button>
                <Mins it={it} />
              </div>
            );
          })}

          {items.length === 0 && !editable && <div className="px-4 py-6 text-center text-sm text-ink-faint dark:text-coal-soft">Empty setlist.</div>}
        </div>

        {editable && (
          <div className="flex flex-wrap gap-1.5 border-t border-paper-line p-2 dark:border-coal-line">
            {(['song', 'banter', 'segment'] as SetKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => add(k)}
                className="flex items-center gap-1 rounded-lg border border-dashed border-paper-line px-2.5 py-1.5 text-xs text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft"
              >
                <Plus className="h-3.5 w-3.5" /> {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const SetlistBlock = Node.create({
  name: 'setlistBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: { default: '' },
      items: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-items') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { items?: SetItem[] }) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
      // Public-share pointer (the off-tree published copy + its link token). Kept
      // off the serialised HTML so it never leaks into a mirror or the shared copy.
      shareId: { default: '', renderHTML: () => ({}) },
      shareToken: { default: '', renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-setlist]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-setlist': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SetlistView);
  },
});
