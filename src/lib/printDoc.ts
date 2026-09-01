import type { Page, TableData, TableRow, Column, CellValue } from '../types';
import { cellText } from './tableQuery';
import { evaluateFormula, formatFormulaValue, formatValue, type FormulaScope } from './formula';

// ---------------------------------------------------------------------------
// printDoc, render a page (its prose + embedded tables) to a standalone HTML
// document for printing / "Save as PDF". A paper backup for a dead phone, so it
// favours plain, legible output over the live UI's interactive widgets (maps,
// clocks) which don't print well.
// ---------------------------------------------------------------------------

interface Store {
  pages: Record<string, Page>;
  tables: Record<string, TableData>;
  rows: Record<string, TableRow>;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

// Minimal scope for computing formula columns at print time (mirrors the live
// buildScope: numbers, dates as day-indices, text/select/place as strings).
function printScope(columns: Column[], cells: Record<string, CellValue>): FormulaScope {
  const dayIndex = (v: CellValue): number => {
    if (typeof v !== 'string') return 0;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
    if (!m) return 0;
    const day = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
    return m[4] !== undefined ? day + (+m[4] * 60 + +m[5]) / 1440 : day;
  };
  const scope: FormulaScope = {};
  for (const c of columns) {
    const v = cells[c.id] ?? null;
    if (c.type === 'number') scope[c.name] = typeof v === 'number' ? v : Number(v) || 0;
    else if (c.type === 'date' || c.type === 'datetime') scope[c.name] = dayIndex(v);
    else if (c.type === 'checkbox') scope[c.name] = v === true ? 1 : 0;
    else if (c.type === 'text' || c.type === 'url' || c.type === 'select' || c.type === 'multiselect' || c.type === 'place') scope[c.name] = cellText(v, c);
  }
  const formulaCols = columns.filter((c) => c.type === 'formula' && c.formula);
  for (let pass = 0; pass < formulaCols.length; pass++) {
    let changed = false;
    for (const c of formulaCols) {
      const v = evaluateFormula(c.formula as string, scope).value;
      if (scope[c.name] !== v) {
        scope[c.name] = v;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return scope;
}

function renderTable(table: TableData, rows: TableRow[]): string {
  if (!table.columns.length) return '';
  // Sort by the first date/datetime column when present, for an itinerary feel.
  const dateCol = table.columns.find((c) => c.type === 'datetime') ?? table.columns.find((c) => c.type === 'date');
  const ordered = dateCol
    ? [...rows].sort((a, b) => String(a.cells[dateCol.id] ?? '').localeCompare(String(b.cells[dateCol.id] ?? '')))
    : rows;

  const head = table.columns.map((c) => `<th>${esc(c.name)}</th>`).join('');
  const body = ordered
    .map((row) => {
      const scope = printScope(table.columns, row.cells);
      const tds = table.columns
        .map((c) => {
          let text: string;
          if (c.type === 'formula') {
            const r = evaluateFormula(c.formula ?? '', scope);
            text = r.ok ? formatFormulaValue(r.value, c.numberFormat) : '';
          } else if ((c.type === 'number' || c.type === 'rollup') && c.numberFormat && c.numberFormat !== 'plain') {
            const raw = row.cells[c.id];
            const n = typeof raw === 'number' ? raw : Number(raw);
            text = Number.isFinite(n) && raw !== null && raw !== undefined && raw !== '' ? formatValue(n, c.numberFormat) : cellText(raw ?? null, c);
          } else {
            text = cellText(row.cells[c.id] ?? null, c);
          }
          return `<td>${esc(text)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<table class="db"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// --- TipTap JSON -> printable HTML ------------------------------------------

interface Node {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function renderText(n: Node): string {
  let out = esc(n.text ?? '');
  for (const m of n.marks ?? []) {
    if (m.type === 'bold') out = `<strong>${out}</strong>`;
    else if (m.type === 'italic') out = `<em>${out}</em>`;
    else if (m.type === 'code') out = `<code>${out}</code>`;
    else if (m.type === 'strike') out = `<s>${out}</s>`;
    else if (m.type === 'link') out = `<a href="${esc(String(m.attrs?.href ?? ''))}">${out}</a>`;
  }
  return out;
}

function renderNode(n: Node, store: Store): string {
  const kids = () => (n.content ?? []).map((c) => renderNode(c, store)).join('');
  switch (n.type) {
    case 'text':
      return renderText(n);
    case 'hardBreak':
      return '<br>';
    case 'paragraph':
      return `<p>${kids()}</p>`;
    case 'heading': {
      const lvl = Math.min(3, Math.max(1, Number(n.attrs?.level) || 1));
      return `<h${lvl}>${kids()}</h${lvl}>`;
    }
    case 'bulletList':
      return `<ul>${kids()}</ul>`;
    case 'orderedList':
      return `<ol>${kids()}</ol>`;
    case 'listItem':
      return `<li>${kids()}</li>`;
    case 'taskList':
      return `<ul class="tasks">${kids()}</ul>`;
    case 'taskItem':
      return `<li>${n.attrs?.checked ? '☑' : '☐'} ${kids()}</li>`;
    case 'blockquote':
      return `<blockquote>${kids()}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${kids()}</code></pre>`;
    case 'horizontalRule':
      return '<hr>';
    case 'image':
      return n.attrs?.src ? `<img src="${esc(String(n.attrs.src))}">` : '';
    case 'rowRef': {
      const row = store.rows[String(n.attrs?.rowId ?? '')];
      const table = store.tables[String(n.attrs?.tableId ?? '')];
      const textCol = table?.columns.find((c) => c.type === 'text');
      const label = (row && textCol && cellText(row.cells[textCol.id] ?? null, textCol)) || 'reference';
      return `<span class="ref">${esc(label)}</span>`;
    }
    case 'pageLink': {
      const p = store.pages[String(n.attrs?.pageId ?? '')];
      return `<p class="pagelink">${esc(p?.icon ? p.icon + ' ' : '↳ ')}${esc(p?.title || 'Untitled page')}</p>`;
    }
    case 'tableEmbed': {
      const table = store.tables[String(n.attrs?.tableId ?? '')];
      if (!table) return '';
      const rows = Object.values(store.rows).filter((r) => r.table === table.id);
      return `<div class="dbwrap"><div class="dbname">${esc(table.name || 'Table')}</div>${renderTable(table, rows)}</div>`;
    }
    case 'placeWidget':
      return n.attrs?.name ? `<p class="place">📍 ${esc(String(n.attrs.name))}${n.attrs.country ? ', ' + esc(String(n.attrs.country)) : ''}</p>` : '';
    case 'countdownBlock':
      return n.attrs?.date ? `<p>⏳ ${esc(String(n.attrs.label ?? 'Countdown'))}: ${esc(String(n.attrs.date))}</p>` : '';
    case 'bookmarkBlock':
    case 'embedBlock': {
      const url = String(n.attrs?.url ?? n.attrs?.src ?? '');
      return url ? `<p><a href="${esc(url)}">${esc(url)}</a></p>` : '';
    }
    default:
      return kids();
  }
}

function styles(): string {
  return `
    * { box-sizing: border-box; }
    body { font: 13px/1.5 -apple-system, system-ui, 'Segoe UI', sans-serif; color: #1a1a1a; margin: 32px; }
    h1.title { font-size: 28px; margin: 0 0 16px; }
    h1 { font-size: 20px; margin: 18px 0 6px; }
    h2 { font-size: 16px; margin: 16px 0 6px; }
    h3 { font-size: 14px; margin: 14px 0 4px; }
    p { margin: 6px 0; }
    ul, ol { margin: 6px 0 6px 22px; }
    ul.tasks { list-style: none; margin-left: 4px; }
    blockquote { border-left: 3px solid #e05a86; margin: 8px 0; padding: 2px 12px; color: #555; }
    pre { background: #f5f3ee; padding: 8px 10px; border-radius: 6px; overflow-x: auto; }
    code { font-family: ui-monospace, monospace; font-size: 12px; }
    hr { border: none; border-top: 1px solid #ddd; margin: 14px 0; }
    img { max-width: 100%; border-radius: 6px; margin: 6px 0; }
    .ref { background: #fce3ec; color: #b03a63; border-radius: 3px; padding: 0 4px; }
    .pagelink { font-weight: 600; }
    .place { color: #b03a63; }
    .dbwrap { margin: 12px 0; break-inside: avoid; }
    .dbname { font-weight: 700; margin-bottom: 4px; }
    table.db { border-collapse: collapse; width: 100%; font-size: 12px; }
    table.db th, table.db td { border: 1px solid #ddd; padding: 4px 7px; text-align: left; vertical-align: top; }
    table.db th { background: #f5f3ee; font-weight: 600; }
    table.db tr { break-inside: avoid; }
    @page { margin: 16mm; }
  `;
}

export function buildPrintHtml(rootPageId: string, store: Store): string {
  const page = store.pages[rootPageId];
  if (!page) return '';
  const titleLine = `${page.icon ? page.icon + ' ' : ''}${esc(page.title || 'Untitled')}`;
  const content = (page.content as Node | null) ?? null;
  const bodyHtml = content && content.content ? content.content.map((c) => renderNode(c, store)).join('') : '<p><em>No content.</em></p>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(page.title || 'Waypoint')}</title><style>${styles()}</style></head><body><h1 class="title">${titleLine}</h1>${bodyHtml}</body></html>`;
}

// The whole trip as one printable booklet: a page and every page under it, in
// sidebar order, with a cover and a contents list. Same renderer as the single
// page, so embedded tables print the same way; this only decides what goes in and
// in what order.
//
// A paper copy is the one backup that works with a dead phone, no signal and a
// blocked domain, which is the actual failure mode a trip has. Trashed pages are
// skipped, and a page whose body is still an `enc:v1:` envelope prints its title
// with a note rather than a wall of ciphertext: unlock the vault and print again.
export function buildBookletHtml(rootPageId: string, store: Store, printedOn: string): string {
  const root = store.pages[rootPageId];
  if (!root) return '';

  // Depth-first through the tree, in the order the sidebar shows.
  const ordered: { page: Page; depth: number }[] = [];
  const walk = (id: string, depth: number) => {
    const p = store.pages[id];
    if (!p || p.trashed) return;
    ordered.push({ page: p, depth });
    Object.values(store.pages)
      .filter((c) => c.parent === id && !c.trashed)
      .sort((a, b) => a.order - b.order)
      .forEach((c) => walk(c.id, depth + 1));
  };
  walk(rootPageId, 0);

  const slug = (id: string) => `pg-${id}`;
  const label = (p: Page) => `${p.icon ? p.icon + ' ' : ''}${esc(p.title || 'Untitled')}`;

  const contents = ordered
    .slice(1) // the root is the cover
    .map(({ page, depth }) => `<li class="toc-${Math.min(depth, 3)}"><a href="#${slug(page.id)}">${label(page)}</a></li>`)
    .join('');

  const body = ordered
    .map(({ page, depth }, i) => {
      const content = (page.content as Node | null) ?? null;
      const inner =
        typeof page.content === 'string'
          ? '<p><em>This page is encrypted. Unlock the vault and print again to include it.</em></p>'
          : content && content.content
            ? content.content.map((c) => renderNode(c, store)).join('')
            : '<p><em>No content.</em></p>';
      const heading = depth === 0 ? 'h1' : depth === 1 ? 'h2' : 'h3';
      return `<section class="sheet${i === 0 ? ' first' : ''}" id="${slug(page.id)}"><${heading} class="title">${label(page)}</${heading}>${inner}</section>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(root.title || 'Waypoint')}</title><style>${styles()}
    .sheet { break-before: page; }
    .sheet.first { break-before: auto; }
    .cover { text-align: center; padding: 28mm 0 0; }
    .cover .big { font-size: 30pt; font-weight: 700; margin: 0 0 6mm; }
    .cover .sub { color: #666; font-size: 11pt; }
    .toc { break-after: page; }
    .toc h2 { margin-bottom: 4mm; }
    .toc ol { list-style: none; padding: 0; }
    .toc li { padding: 1.5mm 0; border-bottom: 1px dotted #ddd; }
    .toc-1 { padding-left: 6mm; }
    .toc-2 { padding-left: 12mm; }
    .toc-3 { padding-left: 18mm; }
    .toc a { color: inherit; text-decoration: none; }
  </style></head><body>
    <div class="cover"><p class="big">${label(root)}</p><p class="sub">${ordered.length} page${ordered.length === 1 ? '' : 's'} &middot; printed ${esc(printedOn)}</p></div>
    ${contents ? `<nav class="toc"><h2>Contents</h2><ol>${contents}</ol></nav>` : ''}
    ${body}
  </body></html>`;
}

// Render the HTML in a hidden iframe and invoke the browser's print dialog
// (where the user can pick "Save as PDF"). Removes the iframe afterwards.
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const win = frame.contentWindow;
  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    win?.focus();
    win?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  // Give images a beat to load so they're included in the print.
  if (win) {
    win.onload = go;
    setTimeout(go, 400);
  }
}
