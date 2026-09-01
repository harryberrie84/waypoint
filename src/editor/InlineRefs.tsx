import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { ForwardedRef } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactRenderer, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { useData, selectWorkspacePages } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { isImageIcon } from '../lib/pageIcon';

// Inline references you type as you write: "@" mentions a workspace member, "[["
// links a page in this workspace. Both are inline atoms whose label lives in attrs
// (so search finds them), with a shared suggestion popup modelled on SlashCommands.

interface RefItem {
  id: string;
  label: string;
  sub: string;
}

// --- shared popup -----------------------------------------------------------

interface MenuRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const RefMenu = forwardRef(function RefMenu(props: SuggestionProps<RefItem>, ref: ForwardedRef<MenuRef>) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [props.items]);

  const pick = (i: number) => {
    const item = props.items[i];
    if (item) props.command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!props.items.length) return false;
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % props.items.length);
        return true;
      }
      if (event.key === 'Enter') {
        pick(selected);
        return true;
      }
      return false;
    },
  }));

  if (!props.items.length) {
    return (
      <div className="w-64 rounded-lg border border-paper-line bg-paper p-3 text-sm text-ink-faint shadow-xl dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft">
        Nothing to link
      </div>
    );
  }

  return (
    <div className="max-h-72 w-64 overflow-y-auto rounded-lg border border-paper-line bg-paper p-1.5 shadow-xl dark:border-coal-line dark:bg-coal-panel">
      {props.items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onMouseEnter={() => setSelected(i)}
          onClick={() => pick(i)}
          className={[
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
            i === selected ? 'bg-paper-panel dark:bg-coal-line' : '',
          ].join(' ')}
        >
          {item.sub && /^\p{Emoji}/u.test(item.sub) ? (
            <span className="w-5 shrink-0 text-center text-base leading-none">{item.sub}</span>
          ) : null}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink dark:text-coal-text">{item.label}</span>
            {item.sub && !/^\p{Emoji}/u.test(item.sub) && (
              <span className="block truncate text-xs text-ink-faint dark:text-coal-soft">{item.sub}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
});

function makeRefRenderer() {
  let component: ReactRenderer<MenuRef, SuggestionProps<RefItem>> | null = null;
  let popup: HTMLDivElement | null = null;

  const place = (clientRect: (() => DOMRect | null) | null | undefined) => {
    if (!popup || !clientRect) return;
    const rect = clientRect();
    if (!rect) return;
    const margin = 8;
    const width = 256;
    let left = rect.left;
    let top = rect.bottom + margin;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    if (top + 288 > window.innerHeight && rect.top - margin - 288 > 0) {
      top = rect.top - margin;
      popup.style.transform = 'translateY(-100%)';
    } else {
      popup.style.transform = 'none';
    }
    popup.style.left = `${Math.max(margin, left)}px`;
    popup.style.top = `${top}px`;
  };

  return {
    onStart: (props: SuggestionProps<RefItem>) => {
      component = new ReactRenderer(RefMenu, { props, editor: props.editor });
      popup = document.createElement('div');
      popup.style.position = 'fixed';
      popup.style.zIndex = '120';
      popup.appendChild(component.element);
      document.body.appendChild(popup);
      place(props.clientRect);
    },
    onUpdate: (props: SuggestionProps<RefItem>) => {
      component?.updateProps(props);
      place(props.clientRect);
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') {
        popup?.remove();
        return true;
      }
      return component?.ref?.onKeyDown(props) ?? false;
    },
    onExit: () => {
      popup?.remove();
      popup = null;
      component?.destroy();
      component = null;
    },
  };
}

function memberItems(query: string): RefItem[] {
  const q = query.trim().toLowerCase();
  return useWorkspace
    .getState()
    .roster.filter((m) => !q || (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q))
    .slice(0, 8)
    .map((m) => ({ id: m.id, label: m.name || m.email || 'Someone', sub: m.email || '' }));
}

function pageItems(query: string): RefItem[] {
  const q = query.trim().toLowerCase();
  const ws = useWorkspace.getState();
  const pages = selectWorkspacePages(useData.getState().pages, ws.activeWorkspaceId ?? ws.defaultWorkspaceId, ws.defaultWorkspaceId);
  return Object.values(pages)
    .filter((p) => !p.trashed && (!q || (p.title || '').toLowerCase().includes(q)))
    .slice(0, 8)
    .map((p) => ({ id: p.id, label: p.title || 'Untitled', sub: isImageIcon(p.icon) ? '' : (p.icon || '') }));
}

// --- @ mention --------------------------------------------------------------

function MentionView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper
      as="span"
      className="rounded bg-clay/10 px-1 py-0.5 text-sm font-medium text-clay dark:bg-clay/15 dark:text-clay-soft"
    >
      @{node.attrs.label || 'someone'}
    </NodeViewWrapper>
  );
}

export const Mention = Node.create({
  name: 'mention',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: { default: '' }, label: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-mention': node.attrs.id }), `@${node.attrs.label}`];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MentionView);
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<RefItem>({
        editor: this.editor,
        char: '@',
        allowSpaces: true,
        pluginKey: new PluginKey('mentionSuggestion'),
        items: ({ query }) => memberItems(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'mention', attrs: { id: props.id, label: props.label } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: makeRefRenderer,
      }),
    ];
  },
});

// --- [[ page link -----------------------------------------------------------

function PageRefView({ node }: NodeViewProps) {
  const open = () => {
    if (node.attrs.pageId) useData.getState().setActivePage(node.attrs.pageId);
  };
  return (
    <NodeViewWrapper
      as="span"
      onClick={open}
      className="cursor-pointer rounded px-0.5 font-medium text-clay underline decoration-clay/40 underline-offset-2 hover:decoration-clay dark:text-clay-soft"
    >
      {node.attrs.label || 'Untitled'}
    </NodeViewWrapper>
  );
}

export const PageRef = Node.create({
  name: 'pageRef',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  addAttributes() {
    // notionId is import-only: an inline link from a Notion export carries the
    // source page id here so the importer can re-point pageId once every page lands.
    return { pageId: { default: '' }, label: { default: '' }, notionId: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-page-ref]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-page-ref': node.attrs.pageId }), node.attrs.label];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageRefView);
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<RefItem>({
        editor: this.editor,
        char: '[[',
        allowSpaces: true,
        pluginKey: new PluginKey('pageRefSuggestion'),
        items: ({ query }) => pageItems(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'pageRef', attrs: { pageId: props.id, label: props.label } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: makeRefRenderer,
      }),
    ];
  },
});
