import { useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, FileText, Network } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspaceKeys } from '../store/useWorkspaceKeys';
import { useWorkspacePages } from '../hooks/useScoped';
import { displayTitle } from '../lib/crypto';
import { buildLinkGraph, outboundOf, backlinksOf } from '../lib/pageLinks';
import { isImageIcon } from '../lib/pageIcon';
import type { Page } from '../types';

function label(p: Page): string {
  return displayTitle(p.title) || 'Untitled';
}

// A "linked from / links to" strip for the bottom of a page.
export function BacklinksStrip({ pageId }: { pageId: string }) {
  const pages = useWorkspacePages();
  const searchLinks = useWorkspaceKeys((s) => s.searchLinks);
  const setActivePage = useData((s) => s.setActivePage);

  const { outbound, inbound } = useMemo(() => {
    const adj = buildLinkGraph(pages, searchLinks);
    return { outbound: outboundOf(adj, pageId), inbound: backlinksOf(adj, pageId) };
  }, [pages, searchLinks, pageId]);

  if (outbound.length === 0 && inbound.length === 0) return null;

  const chips = (ids: string[]) =>
    ids.map((id) => {
      const p = pages[id];
      if (!p) return null;
      return (
        <button
          key={id}
          type="button"
          onClick={() => setActivePage(id)}
          className="inline-flex items-center gap-1 rounded-md border border-paper-line bg-paper px-2 py-1 text-xs text-ink hover:border-clay hover:text-clay dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
        >
          {isImageIcon(p.icon) ? (
            <img src={p.icon} alt="" className="h-4 w-4 rounded object-contain" />
          ) : (
            <span className="text-sm leading-none">{p.icon || '📄'}</span>
          )}
          <span className="max-w-[14rem] truncate">{label(p)}</span>
        </button>
      );
    });

  return (
    <div className="mx-auto mt-10 max-w-3xl space-y-2 border-t border-paper-line pt-4 dark:border-coal-line">
      {inbound.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
            <ArrowDownLeft className="h-3.5 w-3.5" /> Linked from
          </span>
          {chips(inbound)}
        </div>
      )}
      {outbound.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
            <ArrowUpRight className="h-3.5 w-3.5" /> Links to
          </span>
          {chips(outbound)}
        </div>
      )}
    </div>
  );
}

// A small graph of how the workspace's pages link together, current page centred
// and highlighted. Only pages that link or are linked appear, so it stays legible.
export function LinksGraph({ pageId }: { pageId: string }) {
  const pages = useWorkspacePages();
  const searchLinks = useWorkspaceKeys((s) => s.searchLinks);
  const setActivePage = useData((s) => s.setActivePage);

  const { nodes, edges } = useMemo(() => {
    const adj = buildLinkGraph(pages, searchLinks);
    const inGraph = new Set<string>();
    const edges: { from: string; to: string }[] = [];
    for (const [from, tos] of adj) {
      for (const to of tos) {
        inGraph.add(from);
        inGraph.add(to);
        edges.push({ from, to });
      }
    }
    const nodes = [...inGraph].map((id) => pages[id]).filter((p): p is Page => !!p);
    return { nodes, edges };
  }, [pages, searchLinks]);

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-sm text-ink-faint dark:text-coal-soft">
        <Network className="h-6 w-6 text-clay" />
        No links yet. Reference a page with /page or [[ to connect them.
      </div>
    );
  }

  // Circular layout in a square viewBox. The current page sits in the centre so its
  // connections fan out around it.
  const SIZE = 600;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const R = SIZE / 2 - 80;
  const ring = nodes.filter((p) => p.id !== pageId);
  const pos = new Map<string, { x: number; y: number }>();
  if (nodes.some((p) => p.id === pageId)) pos.set(pageId, { x: cx, y: cy });
  ring.forEach((p, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, ring.length) - Math.PI / 2;
    pos.set(p.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  });
  // If the current page isn't in the graph, lay everyone on the ring.
  if (!pos.has(pageId)) {
    nodes.forEach((p, i) => {
      const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      pos.set(p.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full">
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const mine = e.from === pageId || e.to === pageId;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={mine ? 'stroke-clay' : 'stroke-paper-line dark:stroke-coal-line'}
              strokeWidth={mine ? 2 : 1}
              strokeOpacity={mine ? 0.8 : 0.5}
            />
          );
        })}
        {nodes.map((p) => {
          const pt = pos.get(p.id);
          if (!pt) return null;
          const current = p.id === pageId;
          return (
            <g key={p.id} className="cursor-pointer" onClick={() => setActivePage(p.id)}>
              <circle cx={pt.x} cy={pt.y} r={current ? 11 : 7} className={current ? 'fill-clay' : 'fill-paper-panel stroke-paper-line dark:fill-coal-panel dark:stroke-coal-line'} strokeWidth={1} />
              <text
                x={pt.x}
                y={pt.y - (current ? 16 : 12)}
                textAnchor="middle"
                className={`pointer-events-none text-[13px] ${current ? 'fill-clay font-semibold' : 'fill-ink-soft dark:fill-coal-soft'}`}
              >
                {label(p).length > 22 ? `${label(p).slice(0, 21)}…` : label(p)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-ink-faint dark:text-coal-soft">
        <FileText className="h-3.5 w-3.5" /> {nodes.length} connected pages. Click one to open it.
      </p>
    </div>
  );
}
