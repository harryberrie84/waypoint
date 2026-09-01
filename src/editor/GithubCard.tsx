import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { GitBranch, ExternalLink, GitPullRequest, CircleDot } from 'lucide-react';
import { parseGithubUrl, fetchGithub, type GithubData } from '../lib/github';

// githubCard, a rich card for a GitHub repo / issue / PR link: its title and
// open/closed (or merged) state, fetched from the public API. Smart paste inserts
// it for a github.com link; if the fetch fails it still shows the link.

const STATE_STYLE: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  closed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  merged: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  archived: 'bg-paper-line text-ink-faint dark:bg-coal-line dark:text-coal-soft',
};

function GithubCardView({ node }: NodeViewProps) {
  const url = (node.attrs.url as string) || '';
  const ref = parseGithubUrl(url);
  const [data, setData] = useState<GithubData | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!ref) {
      setDone(true);
      return;
    }
    void fetchGithub(ref).then((d) => {
      if (!alive) return;
      setData(d);
      setDone(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const Icon = ref?.kind === 'pr' ? GitPullRequest : ref?.kind === 'issue' ? CircleDot : GitBranch;
  const label = ref ? (ref.kind === 'repo' ? `${ref.owner}/${ref.repo}` : `${ref.owner}/${ref.repo} ${data?.meta ?? ''}`) : url;

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group/gh flex items-center gap-3 rounded-xl border border-paper-line bg-paper-panel/40 px-3 py-2.5 no-underline transition-colors hover:border-clay dark:border-coal-line dark:bg-coal/40"
      >
        <Icon className="h-5 w-5 shrink-0 text-ink-soft dark:text-coal-soft" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink dark:text-coal-text">{data?.title || (done ? label : 'Loading…')}</span>
            {data?.state && (
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATE_STYLE[data.state] ?? STATE_STYLE.archived}`}>
                {data.state}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-ink-faint dark:text-coal-soft">{label}</div>
        </div>
        <ExternalLink className="h-4 w-4 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover/gh:opacity-100 dark:text-coal-soft" />
      </a>
    </NodeViewWrapper>
  );
}

export const GithubCard = Node.create({
  name: 'githubCard',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return { url: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'a[data-github-card]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-github-card': '', href: HTMLAttributes.url }), HTMLAttributes.url];
  },

  addNodeView() {
    return ReactNodeViewRenderer(GithubCardView);
  },
});
