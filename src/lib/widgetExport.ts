import type { SetItem } from './setlistIO';

// ---------------------------------------------------------------------------
// Styled export of the setlist and quiz widgets to a standalone HTML document,
// laid out to match the on-page widget (clay header, numbered circles, segment
// bands, revealed quiz answers) so "Save as PDF" gives a clean, printable copy
// that looks like what's on screen. Pure string builders (no DOM), so they're
// unit-tested; the widgets hand the result to printHtml (lib/printDoc).
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function fmtTotal(mins: number): string {
  if (mins <= 0) return '0 min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}

const BASE_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0; padding: 20px; color: #2b2320; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .card { max-width: 640px; margin: 0 auto; border: 1px solid #ecd9e0; border-radius: 16px; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #ecd9e0; background: linear-gradient(to right, #fce3ec, #ffffff); }
  .head-icon { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; color: #e05a86; font-size: 17px; font-weight: 700; }
  .head-title { flex: 1; min-width: 0; font-size: 18px; font-weight: 600; color: #2b2320; }
  .head-meta { font-size: 12px; color: #8a7f7a; white-space: nowrap; }
  .mins { margin-left: auto; font-size: 12px; color: #8a7f7a; white-space: nowrap; }
  .num { display: inline-flex; width: 26px; height: 26px; border-radius: 999px; background: #fce3ec; color: #e05a86; font-size: 12px; font-weight: 700; align-items: center; justify-content: center; flex: none; }
  .empty { padding: 24px; text-align: center; color: #8a7f7a; font-size: 14px; }
  @page { margin: 14mm; }
`;

const SETLIST_STYLES = `
  .row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid rgba(236,217,224,.7); break-inside: avoid; }
  .row:first-child { border-top: none; }
  .song-main { min-width: 0; }
  .song-title { font-weight: 500; color: #2b2320; }
  .song-sub { font-size: 12px; color: #8a7f7a; }
  .row.say { border-left: 2px dashed rgba(224,90,134,.5); background: rgba(0,0,0,.015); }
  .say-text { font-style: italic; color: #6b625d; font-size: 14px; }
  .row.segment { background: #e05a86; color: #fff; padding: 9px 14px; }
  .seg-label { font-weight: 700; text-transform: uppercase; letter-spacing: .04em; font-size: 13px; }
  .row.segment .mins { color: rgba(255,255,255,.85); }
`;

const QUIZ_STYLES = `
  .qs { list-style: none; margin: 0; padding: 0; }
  .q { display: flex; gap: 12px; padding: 12px 16px; border-top: 1px solid rgba(236,217,224,.7); break-inside: avoid; }
  .q:first-child { border-top: none; }
  .q-main { min-width: 0; flex: 1; }
  .q-text { font-weight: 500; color: #2b2320; }
  .opts { list-style: none; margin: 6px 0 0; padding: 0; }
  .opt { display: flex; align-items: center; gap: 8px; padding: 3px 8px; border-radius: 8px; font-size: 14px; color: #6b625d; }
  .opt.correct { background: rgba(16,185,129,.14); color: #047857; font-weight: 600; }
  .letter { width: 16px; text-align: center; font-size: 12px; font-weight: 700; opacity: .7; }
  .answer { margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; background: rgba(16,185,129,.12); color: #047857; padding: 5px 10px; border-radius: 8px; font-size: 14px; font-weight: 500; }
  .tick { color: #047857; font-weight: 700; }
`;

function docShell(title: string, styles: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_STYLES}${styles}</style></head><body>${body}</body></html>`;
}

/** A setlist as a standalone HTML page, laid out like the widget. */
export function buildSetlistHtml(title: string, items: SetItem[]): string {
  const total = items.reduce((s, it) => s + (typeof it.mins === 'number' ? it.mins : 0), 0);
  const songs = items.filter((i) => i.kind === 'song').length;
  let songNo = 0;
  const rows = items
    .map((it) => {
      const mins = typeof it.mins === 'number' && it.mins > 0 ? `<span class="mins">${it.mins} min</span>` : '';
      if (it.kind === 'segment') return `<div class="row segment"><span class="seg-label">${esc(it.text || 'Segment')}</span>${mins}</div>`;
      if (it.kind === 'banter') return `<div class="row say"><span class="say-text">${esc(it.text || '')}</span>${mins}</div>`;
      songNo += 1;
      const sub = it.sub ? `<div class="song-sub">${esc(it.sub)}</div>` : '';
      return `<div class="row song"><span class="num">${songNo}</span><div class="song-main"><div class="song-title">${esc(it.text || 'Untitled song')}</div>${sub}</div>${mins}</div>`;
    })
    .join('');
  const body = `<div class="card"><div class="head"><span class="head-icon">&#9834;</span><span class="head-title">${esc(title || 'Setlist')}</span><span class="head-meta">${esc(fmtTotal(total))} &middot; ${songs} ${songs === 1 ? 'song' : 'songs'}</span></div>${rows || '<div class="empty">Empty setlist.</div>'}</div>`;
  return docShell(title || 'Setlist', SETLIST_STYLES, body);
}

export interface QuizExportItem {
  text: string;
  answer: string;
  options?: string[];
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** A quiz as a standalone HTML page with the answers shown (a host's copy). */
export function buildQuizHtml(title: string, items: QuizExportItem[]): string {
  const qs = items
    .map((it, qi) => {
      const options = it.options ?? [];
      const optsHtml = options.length
        ? `<ul class="opts">${options
            .map((opt, oi) => {
              const correct = !!opt && !!it.answer && opt.trim().toLowerCase() === it.answer.trim().toLowerCase();
              return `<li class="opt${correct ? ' correct' : ''}"><span class="letter">${LETTERS[oi] ?? '&middot;'}</span><span>${esc(opt)}</span>${correct ? '<span class="tick">&#10003;</span>' : ''}</li>`;
            })
            .join('')}</ul>`
        : '';
      const answer = `<div class="answer"><span class="tick">&#10003;</span> ${esc(it.answer || '(no answer set)')}</div>`;
      return `<li class="q"><span class="num">${qi + 1}</span><div class="q-main"><div class="q-text">${esc(it.text || 'Question')}</div>${optsHtml}${answer}</div></li>`;
    })
    .join('');
  const body = `<div class="card"><div class="head"><span class="head-icon">?</span><span class="head-title">${esc(title || 'Quiz')}</span><span class="head-meta">${items.length} Q</span></div><ol class="qs">${qs || '<li class="empty">No questions yet.</li>'}</ol></div>`;
  return docShell(title || 'Quiz', QUIZ_STYLES, body);
}
