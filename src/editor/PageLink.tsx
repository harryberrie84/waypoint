import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { FileText, ChevronRight, Plus, Search, MoreHorizontal, ExternalLink, Unlink, Trash2, X } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspacePages } from '../hooks/useScoped';
import { useAutoFocus } from './useAutoFocus';
import { isImageIcon } from '../lib/pageIcon';
import { PageIcon } from '../components/PageIcon';

// ---------------------------------------------------------------------------
// pageLink, a Notion-style page reference block in the editor.
// ---------------------------------------------------------------------------
// When linked (a pageId), it resolves the page's icon + title live and clicking
// navigates into it. When unlinked, it shows a picker so /page can EITHER link an
// existing page in this workspace OR create a fresh one. `notionId` + `label` are
// only set by the importer, so unresolved imported links can still be linked by
// hand (the picker pre-fills the original title).

function LinkedView({
  pageId,
  editable,
  onRemove,
  onRelink,
}: {
  pageId: string;
  editable: boolean;
  onRemove: () => void;
  onRelink: () => void;
}) {
  const page = useData((s) => s.pages[pageId]);
  const setActivePage = useData((s) => s.setActivePage);
  const missing = !page || page.trashed;
  const label = missing ? 'Page not found' : page.title || 'Untitled';
  const [menu, setMenu] = useState(false);

  return (
    <NodeViewWrapper className="my-1">
      <div className="relative">
        <button
          type="button"
          contentEditable={false}
          onClick={() => !missing && setActivePage(pageId)}
          onContextMenu={
            editable
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu(true);
                }
              : undefined
          }
          title={editable ? 'Click to open. Right-click for options.' : undefined}
          className={[
            'group/pl flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
            missing
              ? 'cursor-default border-dashed border-clay/50 text-ink-faint dark:text-coal-soft'
              : 'border-paper-line hover:bg-paper-panel dark:border-coal-line dark:hover:bg-coal-line',
          ].join(' ')}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">
            {!missing && page.icon ? (
              isImageIcon(page.icon) ? (
                <img src={page.icon} alt="" className="h-5 w-5 rounded object-contain" />
              ) : (
                page.icon
              )
            ) : (
              <FileText className="h-4 w-4 text-ink-faint dark:text-coal-soft" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink underline-offset-2 group-hover/pl:underline dark:text-coal-text">
            {label}
            {missing && <span className="ml-1.5 text-xs font-normal text-clay">link broken</span>}
          </span>
          {!missing && (
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover/pl:opacity-100 dark:text-coal-soft" />
          )}
          {editable && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Link options"
              title="Options"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(true);
              }}
              className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:bg-paper-line hover:text-ink group-hover/pl:opacity-100 dark:hover:bg-coal-line"
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          )}
        </button>

        {menu && editable && (
          <>
            <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(false)} />
            <div className="absolute left-2 top-full z-50 mt-1 w-52 rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel">
              {!missing && (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    setActivePage(pageId);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                >
                  <ExternalLink className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Open page
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  onRelink();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <Unlink className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Link a different page
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  onRemove();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                <Trash2 className="h-4 w-4" /> Remove this link
              </button>
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}

function PickerView({ label, onLink, onRemove }: { label: string; onLink: (id: string) => void; onRemove: () => void }) {
  const searchRef = useAutoFocus<HTMLInputElement>();
  const pagesMap = useWorkspacePages();
  const activeId = useData((s) => s.activePageId);
  const [q, setQ] = useState(label);

  const matches = Object.values(pagesMap)
    .filter((p) => !p.trashed && !p.template && p.id !== activeId)
    .filter((p) => (p.title || 'Untitled').toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .slice(0, 8);

  const createNew = () => {
    const parent = useData.getState().activePageId ?? '';
    void useData
      .getState()
      .createPage(parent, false)
      .then((id) => {
        if (!id) return;
        if (q.trim()) useData.getState().renamePage(id, q.trim());
        onLink(id);
      });
  };

  return (
    <NodeViewWrapper className="my-1" contentEditable={false}>
      <div className="relative rounded-md border border-paper-line bg-paper-panel/40 p-2 dark:border-coal-line dark:bg-coal/30">
        <button
          type="button"
          onClick={onRemove}
          title="Remove this link block"
          className="absolute right-1 top-1 z-10 rounded p-0.5 text-ink-faint hover:bg-paper-line hover:text-rose-500 dark:hover:bg-coal-line"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="mb-1.5 mr-6 flex items-center gap-1.5 rounded border border-paper-line bg-paper px-2 py-1 dark:border-coal-line dark:bg-coal-panel">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Link a page, or type a name to create one"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none dark:text-coal-text"
          />
        </div>
        <div className="max-h-52 overflow-y-auto">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onLink(p.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-paper-panel dark:hover:bg-coal-line"
            >
              <span className="flex items-center text-base leading-none"><PageIcon icon={p.icon} size="h-4 w-4" /></span>
              <span className="min-w-0 flex-1 truncate text-ink dark:text-coal-text">{p.title || 'Untitled'}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={createNew}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm font-medium text-clay hover:bg-paper-panel dark:hover:bg-coal-line"
          >
            <Plus className="h-4 w-4 shrink-0" /> Create {q.trim() ? `"${q.trim()}"` : 'a new page'}
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function PageLinkView({ node, updateAttributes, editor, deleteNode }: NodeViewProps) {
  const pageId = node.attrs.pageId as string;
  const label = (node.attrs.label as string) || '';

  if (pageId) {
    return (
      <LinkedView
        pageId={pageId}
        editable={editor.isEditable}
        onRemove={() => deleteNode()}
        onRelink={() => updateAttributes({ pageId: '', notionId: '' })}
      />
    );
  }

  if (editor.isEditable) {
    return <PickerView label={label} onLink={(id) => updateAttributes({ pageId: id, notionId: '' })} onRemove={() => deleteNode()} />;
  }
  // Read-only and never linked: a quiet placeholder.
  return (
    <NodeViewWrapper className="my-1">
      <span className="text-sm text-ink-faint dark:text-coal-soft">{label ? `↪ ${label}` : 'Unlinked page'}</span>
    </NodeViewWrapper>
  );
}

export const PageLink = Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      pageId: { default: '' },
      // Importer-only: the source Notion id and the original link text, used to
      // resolve the link after every page is created (and to seed the picker if
      // it couldn't be resolved).
      notionId: { default: '' },
      label: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-page-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-link': '', 'data-page-id': HTMLAttributes.pageId })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView);
  },
});
