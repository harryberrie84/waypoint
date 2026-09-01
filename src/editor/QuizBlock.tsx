import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { HelpCircle, Eye, EyeOff, Plus, Trash2, ChevronUp, ChevronDown, Check, X, Printer, Download, Upload, FileDown, Copy } from 'lucide-react';
import { buildQuizHtml } from '../lib/widgetExport';
import { printHtml } from '../lib/printDoc';
import { WidgetShare } from './WidgetShare';
import { serializeQuiz, parseQuiz, QUIZ_TEMPLATE, type QuizItem } from '../lib/quizIO';
import { toast } from '../store/useToast';

// quizBlock, a small quiz you can run live. Each question has optional multiple
// choice options and an answer that stays hidden behind a "Reveal" button, so the
// host can ask the room, take guesses, then reveal. "Reveal all / Hide all" resets
// it between runs. Built for the gig's intro quiz, but works for any quiz. The
// searchable text is each question's `text` (lib/search.ts reads `item.text`).
// Import / export / blank template round-trip through lib/quizIO (plain text).

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
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

function readItems(attrs: Record<string, unknown>): QuizItem[] {
  const raw = attrs.items;
  return Array.isArray(raw) ? (raw as QuizItem[]) : [];
}

function QuizView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const items = readItems(node.attrs);
  const title = (node.attrs.title as string) || '';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');

  const write = (next: QuizItem[]) => updateAttributes({ items: next });
  const patch = (id: string, p: Partial<QuizItem>) => write(items.map((it) => (it.id === id ? { ...it, ...p } : it)));
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
  const add = () => {
    const it: QuizItem = { id: newId(), text: '', answer: '', options: [] };
    write([...items, it]);
    setEditingId(it.id);
  };

  const doExport = () => downloadText(`${(title || 'quiz').replace(/[^\w-]+/g, '_')}.txt`, serializeQuiz(title, items));
  const doCopy = () => {
    void navigator.clipboard?.writeText(serializeQuiz(title, items));
    toast('Quiz copied');
  };
  const doImport = () => {
    const parsed = parseQuiz(importText);
    if (parsed.items.length === 0) {
      toast('Nothing to import, check the format', 'error');
      return;
    }
    updateAttributes({ title: parsed.title || title, items: parsed.items.map((it) => ({ ...it, id: newId() })) });
    setImporting(false);
    setImportText('');
    toast(`Imported ${parsed.items.length} ${parsed.items.length === 1 ? 'question' : 'questions'}`);
  };
  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allRevealed = items.length > 0 && items.every((it) => revealed.has(it.id));

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-2xl border border-paper-line bg-paper-panel/30 dark:border-coal-line dark:bg-coal/30">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-paper-line bg-gradient-to-r from-clay-wash/70 to-transparent px-4 py-3 dark:border-coal-line dark:from-clay/10">
          <HelpCircle className="h-5 w-5 shrink-0 text-clay" />
          {editable ? (
            <input
              value={title}
              onChange={(e) => updateAttributes({ title: e.target.value })}
              placeholder="Quiz title (e.g. Intro quiz)"
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
            />
          ) : (
            <div className="min-w-0 flex-1 truncate text-lg font-semibold text-ink dark:text-coal-text">{title || 'Quiz'}</div>
          )}
          <span className="whitespace-nowrap text-xs text-ink-soft dark:text-coal-soft">{items.length} Q</span>
          <button
            type="button"
            onClick={() => printHtml(buildQuizHtml(title, items))}
            className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line"
            title="Export a styled PDF (answers shown; Save as PDF)"
          >
            <Printer className="h-4 w-4" />
          </button>
          {editable && (
            <WidgetShare
              attrs={node.attrs}
              updateAttributes={updateAttributes}
              title={title || 'Quiz'}
              label="quiz"
              docOf={() => ({ type: 'doc', content: [{ type: 'quizBlock', attrs: { title, items } }] })}
            />
          )}
          {editable && (
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={doExport} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line" title="Export to a .txt file">
                <Download className="h-4 w-4" />
              </button>
              <button type="button" onClick={doCopy} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line" title="Copy as text">
                <Copy className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => downloadText('quiz-template.txt', QUIZ_TEMPLATE)} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line" title="Download a fill-in template">
                <FileDown className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setImporting((v) => !v)} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line" title="Import from text">
                <Upload className="h-4 w-4" />
              </button>
            </div>
          )}
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setRevealed(allRevealed ? new Set() : new Set(items.map((it) => it.id)))}
              className="flex items-center gap-1 rounded-lg border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
            >
              {allRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {allRevealed ? 'Hide all' : 'Reveal all'}
            </button>
          )}
        </div>

        {editable && importing && (
          <div className="space-y-2 border-b border-paper-line bg-paper/60 p-3 dark:border-coal-line dark:bg-coal/40">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={6}
              placeholder={`Paste a quiz:\n\nQ: your question\n- option A\n- option B\nA: the answer\n\nQ: a question with no options\nA: its answer`}
              className="w-full resize-none rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
            />
            <div className="flex items-center gap-2">
              <button type="button" onClick={doImport} className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90">
                Load
              </button>
              <button type="button" onClick={() => setImporting(false)} className="text-sm text-ink-faint hover:text-ink dark:text-coal-soft">
                Cancel
              </button>
              <span className="ml-auto text-[10px] text-ink-faint dark:text-coal-soft">replaces the questions below</span>
            </div>
          </div>
        )}

        <ol className="divide-y divide-paper-line/70 dark:divide-coal-line/70">
          {items.map((it, qi) => {
            if (editingId === it.id && editable) {
              const opts = it.options ?? [];
              return (
                <li key={it.id} className="space-y-2 bg-paper/60 p-3 dark:bg-coal/40">
                  <input
                    value={it.text}
                    onChange={(e) => patch(it.id, { text: e.target.value })}
                    placeholder="Question"
                    className="w-full rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm font-medium text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                  />
                  <div className="space-y-1">
                    {opts.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-1.5">
                        <span className="w-4 text-center text-xs font-bold text-ink-faint dark:text-coal-soft">{LETTERS[oi] ?? '·'}</span>
                        <input
                          value={opt}
                          onChange={(e) => patch(it.id, { options: opts.map((o, k) => (k === oi ? e.target.value : o)) })}
                          placeholder={`Option ${LETTERS[oi] ?? ''}`}
                          className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                        />
                        <button type="button" onClick={() => patch(it.id, { options: opts.filter((_, k) => k !== oi) })} className="rounded-md p-1 text-ink-faint hover:text-rose-500" title="Remove option">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {opts.length < LETTERS.length && (
                      <button type="button" onClick={() => patch(it.id, { options: [...opts, ''] })} className="ml-5 flex items-center gap-1 text-xs text-clay hover:underline">
                        <Plus className="h-3 w-3" /> add option
                      </button>
                    )}
                  </div>
                  <input
                    value={it.answer}
                    onChange={(e) => patch(it.id, { answer: e.target.value })}
                    placeholder="Answer (type it, or copy the right option)"
                    className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-sm text-ink outline-none dark:text-coal-text"
                  />
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => move(it.id, -1)} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line" title="Move up">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => move(it.id, 1)} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line" title="Move down">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => remove(it.id)} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-rose-500 dark:hover:bg-coal-line" title="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="ml-auto flex items-center gap-1 rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90">
                      <Check className="h-3.5 w-3.5" /> Done
                    </button>
                  </div>
                </li>
              );
            }

            const show = revealed.has(it.id);
            return (
              <li key={it.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay-wash text-xs font-bold tabular-nums text-clay dark:bg-clay/20 dark:text-clay-soft">{qi + 1}</span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => (editable ? setEditingId(it.id) : undefined)}
                      className={`block text-left font-medium text-ink dark:text-coal-text ${editable ? 'cursor-pointer hover:text-clay' : 'cursor-default'}`}
                    >
                      {it.text || (editable ? 'Write a question…' : 'Question')}
                    </button>
                    {(it.options ?? []).length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {(it.options ?? []).map((opt, oi) => {
                          const correct = show && opt && opt.trim().toLowerCase() === it.answer.trim().toLowerCase();
                          return (
                            <li key={oi} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${correct ? 'bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-300' : 'text-ink-soft dark:text-coal-soft'}`}>
                              <span className="w-4 text-center text-xs font-bold opacity-70">{LETTERS[oi] ?? '·'}</span>
                              <span className="min-w-0 flex-1">{opt}</span>
                              {correct && <Check className="h-3.5 w-3.5 shrink-0" />}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {show ? (
                      <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="font-medium">{it.answer || '(no answer set)'}</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleReveal(it.id)}
                        className="mt-2 flex items-center gap-1 rounded-lg border border-paper-line px-2.5 py-1 text-xs text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft"
                      >
                        <Eye className="h-3.5 w-3.5" /> Reveal answer
                      </button>
                    )}
                    {show && (
                      <button type="button" onClick={() => toggleReveal(it.id)} className="mt-1 text-[11px] text-ink-faint hover:underline dark:text-coal-soft">
                        hide
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {items.length === 0 && !editable && <li className="px-4 py-6 text-center text-sm text-ink-faint dark:text-coal-soft">No questions yet.</li>}
        </ol>

        {editable && (
          <div className="border-t border-paper-line p-2 dark:border-coal-line">
            <button
              type="button"
              onClick={add}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-line py-2 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line"
            >
              <Plus className="h-4 w-4" /> Add a question
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const QuizBlock = Node.create({
  name: 'quizBlock',
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
        renderHTML: (attrs: { items?: QuizItem[] }) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
      // Public-share pointer (the off-tree published copy + its link token). Kept
      // off the serialised HTML so it never leaks into a mirror or the shared copy.
      shareId: { default: '', renderHTML: () => ({}) },
      shareToken: { default: '', renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-quiz]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-quiz': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(QuizView);
  },
});
