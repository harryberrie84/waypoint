import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Blocks, ExternalLink, Search, Unlink, Lock } from 'lucide-react';
import { useData, selectWorkspacePages } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { useWorkspaceKeys } from '../store/useWorkspaceKeys';
import { isEnvelope } from '../lib/crypto';
import { useAutoFocus } from './useAutoFocus';
import { PageIcon } from '../components/PageIcon';

// syncedBlock, a live read-only mirror of another page's content. Edit the source
// page and every mirror updates. It reuses the same decryption as the page view
// and renders with a read-only editor loaded lazily (so there's no import cycle
// with the main editor). One source, many places: shared house rules, packing
// basics, a recurring agenda.

interface MirrorEditorProps {
  content: object | null;
  editable: boolean;
  onChange: (json: object) => void;
}

function SyncedView({ node, updateAttributes, editor }: NodeViewProps) {
  const sourceId = (node.attrs.sourceId as string) || '';
  const editable = editor.isEditable;

  const pages = useData((s) => s.pages);
  const setActivePage = useData((s) => s.setActivePage);
  const decryptForPage = useWorkspaceKeys((s) => s.decryptForPage);
  const activeId = useWorkspace((s) => s.activeWorkspaceId);
  const defaultId = useWorkspace((s) => s.defaultWorkspaceId);

  const source = sourceId ? pages[sourceId] : null;
  const currentPageId = useData.getState().activePageId;

  const [Mirror, setMirror] = useState<ComponentType<MirrorEditorProps> | null>(null);
  const [content, setContent] = useState<object | null>(null);
  const [query, setQuery] = useState('');
  const searchRef = useAutoFocus<HTMLInputElement>(!sourceId && editable);

  // Load the editor lazily so this file never statically imports it (that would
  // be a cycle, since the editor registers this node).
  useEffect(() => {
    let alive = true;
    void import('../components/Editor').then((m) => {
      if (alive) setMirror(() => m.Editor as unknown as ComponentType<MirrorEditorProps>);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Resolve the source's content, decrypting if it's locked. Re-runs when the
  // source changes, so edits there flow through to the mirror.
  useEffect(() => {
    let alive = true;
    if (!source) {
      setContent(null);
      return;
    }
    const c = source.content;
    if (isEnvelope(c)) {
      void decryptForPage(source, c as string)
        .then((plain) => {
          if (alive) setContent((plain as object) ?? null);
        })
        .catch(() => {
          if (alive) setContent(null);
        });
    } else {
      setContent((c as object) ?? null);
    }
    return () => {
      alive = false;
    };
  }, [source, source?.content, decryptForPage]);

  // Picker: no source yet.
  if (!source) {
    const options = Object.values(selectWorkspacePages(pages, activeId ?? defaultId, defaultId))
      .filter((p) => !p.trashed && p.id !== currentPageId && !isEnvelope(p.title))
      .filter((p) => !query.trim() || (p.title || '').toLowerCase().includes(query.trim().toLowerCase()))
      .slice(0, 8);
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <div className="rounded-xl border border-dashed border-paper-line bg-paper-panel/40 p-3 dark:border-coal-line dark:bg-coal/40">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <Blocks className="h-3.5 w-3.5 text-clay" /> Mirror a page
          </div>
          {sourceId && !source ? (
            <p className="text-sm text-ink-faint dark:text-coal-soft">That page is gone.</p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-paper-line px-2 dark:border-coal-line">
                <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a page to mirror here…"
                  className="w-full bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
                />
              </div>
              <div className="space-y-0.5">
                {options.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => updateAttributes({ sourceId: p.id })}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                  >
                    <span className="flex w-5 shrink-0 items-center justify-center"><PageIcon icon={p.icon} size="h-4 w-4" /></span>
                    <span className="truncate">{p.title || 'Untitled'}</span>
                  </button>
                ))}
                {options.length === 0 && <p className="px-2 py-1 text-sm text-ink-faint dark:text-coal-soft">No other pages here yet.</p>}
              </div>
            </>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  const locked = isEnvelope(source.content) && !content;

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-xl border border-paper-line dark:border-coal-line">
        <div className="flex items-center gap-2 border-b border-paper-line bg-paper-panel/60 px-3 py-1.5 dark:border-coal-line dark:bg-coal/50">
          <Blocks className="h-3.5 w-3.5 shrink-0 text-clay" />
          <span className="truncate text-xs font-medium text-ink-soft dark:text-coal-soft">
            Synced from <PageIcon icon={source.icon} fallback="" size="inline-block h-3 w-3 rounded-sm align-text-bottom" /> {source.title || 'Untitled'}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActivePage(source.id)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line"
              title="Open the source to edit"
            >
              <ExternalLink className="h-3 w-3" /> Open
            </button>
            {editable && (
              <button
                type="button"
                onClick={() => updateAttributes({ sourceId: '' })}
                className="rounded p-0.5 text-ink-faint hover:text-rose-500"
                title="Unlink this mirror"
              >
                <Unlink className="h-3 w-3" />
              </button>
            )}
          </span>
        </div>
        <div className="px-3 py-2">
          {locked ? (
            <p className="flex items-center gap-1.5 text-sm text-ink-faint dark:text-coal-soft">
              <Lock className="h-3.5 w-3.5" /> Unlock the vault to see this.
            </p>
          ) : Mirror && content ? (
            <div className="synced-mirror text-sm">
              <Mirror content={content} editable={false} onChange={() => {}} />
            </div>
          ) : (
            <p className="text-sm text-ink-faint dark:text-coal-soft">Loading…</p>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const SyncedBlock = Node.create({
  name: 'syncedBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return { sourceId: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'div[data-synced]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-synced': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SyncedView);
  },
});
