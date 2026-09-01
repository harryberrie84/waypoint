import { useState, useRef, useEffect, useMemo } from 'react';
import { Type, Hash, Tag, Tags, Calendar, CalendarClock, Sigma, CheckSquare, Link as LinkIcon, Link2, Calculator, BarChart3, Zap, ExternalLink, MapPin, Search, Loader2, X, Paperclip, AlarmClock, Clock, Globe, Users, Plus, Minus, Pencil, Eye, Check, UserPlus, ListChecks, Upload } from 'lucide-react';
import { useData } from '../store/useData';
import { TAG_COLORS, uid } from '../lib/id';
import type { ChecklistItem } from '../types';
import { useWorkspace } from '../store/useWorkspace';
import { toast } from '../store/useToast';
import { parseCellLink, formatCellLink, linkHref, type CellLink } from '../lib/cellLink';
import type { Column, ColumnType, CellValue, GeoValue, SelectOption } from '../types';
import { evaluateFormula, formatValue, formatFormulaValue, type FormulaValue } from '../lib/formula';
import { geoOf, attachmentOf, resolveLookup } from '../lib/tableQuery';
import { coerceNumber, buildScope } from '../lib/scope';
import { dateStatus } from '../lib/reminders';
import { parseLocaleNumber } from '../lib/number';
import { parseHumanDate } from '../lib/humanDate';
import { searchPois, poiToGeo, categoryLabel } from '../lib/poi';
import { applyActions } from '../lib/automations';
import { processAttachmentFile, FileTooLargeError, formatBytes } from '../lib/image';
import { collectMedia, pageTables } from '../lib/tripViews';
import { isEnvelope } from '../lib/crypto';
import { uploadsApi } from '../lib/api';
import { UploadModal } from './UploadModal';
import { useMembers } from '../hooks/useMembers';
import { initials, avatarColor } from '../lib/avatar';
import { Popover } from './Popover';
import { GrowTextarea } from './GrowTextarea';
import { DateCalendar } from './DateCalendar';

// Shared bits used by every table view (grid, board, gallery, calendar) so a
// cell edits identically everywhere.

export const TYPE_META: Record<ColumnType, { icon: typeof Type; label: string }> = {
  text: { icon: Type, label: 'Text' },
  number: { icon: Hash, label: 'Number' },
  select: { icon: Tag, label: 'Select' },
  multiselect: { icon: Tags, label: 'Multi-select' },
  date: { icon: Calendar, label: 'Date' },
  datetime: { icon: CalendarClock, label: 'Date & time' },
  checkbox: { icon: CheckSquare, label: 'Checkbox' },
  url: { icon: LinkIcon, label: 'URL' },
  place: { icon: MapPin, label: 'Place' },
  attachment: { icon: Paperclip, label: 'Attachment' },
  reminder: { icon: AlarmClock, label: 'Reminder' },
  relation: { icon: Link2, label: 'Relation' },
  rollup: { icon: Calculator, label: 'Rollup' },
  lookup: { icon: Eye, label: 'Lookup' },
  progress: { icon: BarChart3, label: 'Progress' },
  button: { icon: Zap, label: 'Button' },
  person: { icon: Users, label: 'Person' },
  formula: { icon: Sigma, label: 'Formula' },
  checklist: { icon: ListChecks, label: 'Checklist' },
};

// Formula-scope logic now lives in lib/scope (pure, React-free) so libs can use
// it too; imported for this file's own use and re-exported for its importers.
export { coerceNumber, buildScope };

// A short, locale-aware rendering of a stored ISO value for the cell's resting state.
function cellDate(value: string, withTime: boolean): string {
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return value;
  const dt = new Date(y, m - 1, d, timePart ? Number(timePart.slice(0, 2)) : 0, timePart ? Number(timePart.slice(3, 5)) : 0);
  const date = dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return withTime && timePart ? `${date} ${dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : date;
}

// A date cell you can type into in words ("next friday", "in 3 weeks", "tomorrow
// 9am") as well as pick from the native calendar. The stored value stays ISO, so
// everything downstream (calendar, cron, formulas) is unchanged.
function NaturalDateInput({
  value,
  onChange,
  withTime,
  inputClassName,
  leading,
}: {
  value: string;
  onChange: (v: string | null) => void;
  withTime: boolean;
  inputClassName: string;
  leading?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const commit = (raw: string) => {
    const t = raw.trim();
    if (!t) {
      onChange(null);
      return;
    }
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(t)) {
      onChange(withTime ? (t.includes('T') ? t : `${t}T09:00`) : t.slice(0, 10));
      return;
    }
    const parsed = parseHumanDate(t, Date.now());
    if (parsed) onChange(withTime ? (parsed.hasTime ? parsed.iso : `${parsed.iso}T09:00`) : parsed.iso.slice(0, 10));
    // Unparsed text leaves the value as it was.
  };

  return (
    <div ref={anchorRef} className="relative flex min-h-[38px] items-center gap-1 px-1.5">
      {leading}
      <input
        value={editing ? text : value ? cellDate(value, withTime) : ''}
        onFocus={() => {
          setEditing(true);
          setText(value ? (withTime ? value.slice(0, 16) : value.slice(0, 10)) : '');
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          commit(text);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(text);
            setEditing(false);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        placeholder="next friday…"
        className={inputClassName}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setPickerOpen((o) => !o)}
        className="shrink-0 rounded p-0.5 text-ink-faint hover:text-clay"
        title="Pick from a calendar"
      >
        <Calendar className="h-3 w-3" />
      </button>
      <Popover open={pickerOpen} onClose={() => setPickerOpen(false)} anchorRef={anchorRef} width={272}>
        <DateCalendar value={value} withTime={withTime} onChange={onChange} onClose={() => setPickerOpen(false)} />
      </Popover>
    </div>
  );
}

export function Cell({
  tableId,
  rowId,
  column,
  value,
  scope,
}: {
  tableId: string;
  rowId: string;
  column: Column;
  value: CellValue;
  scope: Record<string, FormulaValue>;
}) {
  const setCell = useData((s) => s.setCell);

  if (column.type === 'formula') {
    const result = evaluateFormula(column.formula ?? '', scope);
    return (
      <div className="px-2 py-2.5 font-mono text-xs">
        {result.ok ? (
          <span className="text-ink dark:text-coal-text">{formatFormulaValue(result.value, column.numberFormat)}</span>
        ) : (
          <span className="text-red-500" title={result.error}>
            #ERR
          </span>
        )}
      </div>
    );
  }

  if (column.type === 'number') {
    return <NumberCell rowId={rowId} column={column} value={value} />;
  }

  if (column.type === 'relation') {
    return <RelationCell rowId={rowId} column={column} value={value} />;
  }

  if (column.type === 'rollup') {
    return <RollupCell tableId={tableId} rowId={rowId} column={column} />;
  }

  if (column.type === 'lookup') {
    return <LookupCell tableId={tableId} rowId={rowId} column={column} />;
  }

  if (column.type === 'progress') {
    return <ProgressCell tableId={tableId} rowId={rowId} column={column} value={value} />;
  }

  if (column.type === 'button') {
    return <ButtonCell rowId={rowId} column={column} />;
  }

  // At-a-glance due colour for date-ish cells: red when overdue, clay when today.
  const due = dateStatus(value, Date.now());
  const dueText = due === 'overdue' ? 'text-red-500' : due === 'today' ? 'text-clay' : 'text-ink dark:text-coal-text';

  if (column.type === 'date') {
    return (
      <NaturalDateInput
        value={typeof value === 'string' ? value : ''}
        onChange={(v) => setCell(rowId, column.id, v)}
        withTime={false}
        inputClassName={`min-w-0 flex-1 bg-transparent text-xs ${dueText} outline-none placeholder:text-ink-faint focus:bg-clay-wash/40 dark:focus:bg-clay/15`}
      />
    );
  }

  if (column.type === 'datetime') {
    return (
      <NaturalDateInput
        value={typeof value === 'string' ? value : ''}
        onChange={(v) => setCell(rowId, column.id, v)}
        withTime
        inputClassName={`min-w-0 flex-1 bg-transparent text-xs ${dueText} outline-none placeholder:text-ink-faint focus:bg-clay-wash/40 dark:focus:bg-clay/15`}
      />
    );
  }

  if (column.type === 'reminder') {
    // Just a datetime, the lead time lives on the column; the bell polls it.
    return (
      <NaturalDateInput
        value={typeof value === 'string' ? value : ''}
        onChange={(v) => setCell(rowId, column.id, v)}
        withTime
        leading={<AlarmClock className="h-3 w-3 shrink-0 text-clay" />}
        inputClassName={`min-w-0 flex-1 bg-transparent text-xs ${dueText} outline-none placeholder:text-ink-faint focus:bg-clay-wash/40 dark:focus:bg-clay/15`}
      />
    );
  }

  if (column.type === 'attachment') {
    return <AttachmentCell rowId={rowId} column={column} value={value} />;
  }

  if (column.type === 'checkbox') {
    return (
      <div className="flex min-h-[38px] items-center px-2 py-2.5">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => setCell(rowId, column.id, e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-clay"
        />
      </div>
    );
  }

  if (column.type === 'url') {
    return <UrlCell rowId={rowId} column={column} value={value} />;
  }

  if (column.type === 'select') {
    return <SelectCell tableId={tableId} rowId={rowId} column={column} value={value} />;
  }

  if (column.type === 'multiselect') {
    return <MultiSelectCell tableId={tableId} rowId={rowId} column={column} value={value} />;
  }

  if (column.type === 'place') {
    return <PlaceCell rowId={rowId} column={column} value={value} />;
  }

  if (column.type === 'person') {
    return <PersonCell rowId={rowId} column={column} value={value} />;
  }

  if (column.type === 'checklist') {
    return <ChecklistCell rowId={rowId} column={column} value={value} />;
  }

  return <TextCell rowId={rowId} column={column} value={value} />;
}

// Checklist cell: a compact progress bar in the grid/card that opens a full
// editor (add items, tick them, set a due date and assignee per item).
function readChecklist(v: CellValue): ChecklistItem[] {
  return Array.isArray(v)
    ? (v as unknown as ChecklistItem[]).filter((i) => i && typeof i === 'object' && typeof i.text === 'string')
    : [];
}

export function checklistProgress(v: CellValue): { done: number; total: number } {
  const items = readChecklist(v);
  return { done: items.filter((i) => i.checked).length, total: items.length };
}

// The editing surface itself, shared by the compact grid popover and the row
// drawer's full-width inline version (big), so the two can't drift apart. Big
// scales everything up: real text size, roomier rows, larger tap targets.
function ChecklistEditor({ rowId, column, value, big }: { rowId: string; column: Column; value: CellValue; big?: boolean }) {
  const setCell = useData((s) => s.setCell);
  const members = useMembers();
  const [draft, setDraft] = useState('');
  const [assignFor, setAssignFor] = useState<string | null>(null);

  const items = readChecklist(value);
  const done = items.filter((i) => i.checked).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  const save = (next: ChecklistItem[]) => setCell(rowId, column.id, next as unknown as CellValue);
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    save([...items, { id: uid('cl'), text: t, checked: false }]);
    setDraft('');
  };
  const patch = (id: string, p: Partial<ChecklistItem>) => save(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const remove = (id: string) => save(items.filter((i) => i.id !== id));

  const box = big ? 'h-4 w-4' : 'h-3.5 w-3.5';
  const icon = big ? 'h-4 w-4' : 'h-3.5 w-3.5';
  const text = big ? 'text-sm' : 'text-xs';

  return (
    <>
      {items.length > 0 && (
        <div className={`flex items-center gap-2 px-1 ${big ? 'mb-2' : 'mb-1.5'}`}>
          <div className={`flex-1 overflow-hidden rounded-full bg-paper-line dark:bg-coal-line ${big ? 'h-2' : 'h-1.5'}`}>
            <div className="h-full rounded-full bg-clay" style={{ width: `${pct}%` }} />
          </div>
          <span className={`shrink-0 tabular-nums text-ink-faint dark:text-coal-soft ${big ? 'text-xs' : 'text-[11px]'}`}>
            {big ? `${done}/${items.length} · ${pct}%` : `${pct}%`}
          </span>
        </div>
      )}
      {items.map((it) => (
        <div key={it.id} className={`group/cl rounded hover:bg-paper-panel dark:hover:bg-coal-line ${big ? 'mb-1 px-1.5 py-1' : 'mb-0.5 px-1 py-0.5'}`}>
          {/* items-start + a wrapping textarea: a long item grows DOWN, never
              into a sideways scroll; the controls stay pinned to the first line. */}
          <div className={`flex items-start ${big ? 'gap-2.5' : 'gap-1.5'}`}>
            <input type="checkbox" checked={it.checked} onChange={(e) => patch(it.id, { checked: e.target.checked })} className={`${box} shrink-0 cursor-pointer accent-clay ${big ? 'mt-0.5' : 'mt-px'}`} />
            <GrowTextarea
              value={it.text}
              onChange={(v) => patch(it.id, { text: v })}
              onKeyDown={(e) => {
                // An item is one entry, not a paragraph: Enter just settles it.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className={`min-w-0 flex-1 bg-transparent outline-none ${text} ${it.checked ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink dark:text-coal-text'}`}
            />
            <label className={`shrink-0 cursor-pointer rounded text-ink-faint hover:text-clay ${big ? 'p-1' : 'p-0.5'}`} title="Due date">
              <Calendar className={icon} />
              <input type="date" value={it.due ?? ''} onChange={(e) => patch(it.id, { due: e.target.value || undefined })} className="sr-only" />
            </label>
            <button type="button" onClick={() => setAssignFor((a) => (a === it.id ? null : it.id))} title="Assign" className={`shrink-0 rounded text-ink-faint hover:text-clay ${big ? 'p-1' : 'p-0.5'}`}>
              {it.who ? <Avatar id={it.who} name={members.find((m) => m.id === it.who)?.name ?? '?'} /> : <UserPlus className={icon} />}
            </button>
            <button type="button" onClick={() => remove(it.id)} className={`invisible shrink-0 rounded text-ink-faint hover:text-rose-500 group-hover/cl:visible ${big ? 'p-1' : 'p-0.5'}`}>
              <X className={big ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
            </button>
          </div>
          {it.due && <div className={`text-ink-faint dark:text-coal-soft ${big ? 'ml-7 text-xs' : 'ml-5 text-[10px]'}`}>due {it.due}</div>}
          {assignFor === it.id && (
            <div className={`mt-1 flex flex-wrap gap-1 ${big ? 'ml-7' : 'ml-5'}`}>
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { patch(it.id, { who: it.who === m.id ? undefined : m.id }); setAssignFor(null); }}
                  className={`rounded ${big ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]'} ${it.who === m.id ? 'bg-clay text-white' : 'bg-paper-panel text-ink-soft dark:bg-coal-line dark:text-coal-soft'}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="mt-1 flex items-start gap-1 border-t border-paper-line pt-1 dark:border-coal-line">
        <GrowTextarea
          value={draft}
          onChange={setDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add an item…"
          className={`min-w-0 flex-1 bg-transparent text-ink outline-none dark:text-coal-text ${big ? 'px-1.5 py-1.5 text-sm' : 'px-1.5 py-1 text-xs'}`}
        />
      </div>
    </>
  );
}

export function ChecklistCell({ rowId, column, value }: { rowId: string; column: Column; value: CellValue }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { done, total } = checklistProgress(value);
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-[38px] w-full items-center gap-2 px-2 py-1 text-left">
        {total ? (
          <>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-paper-line dark:bg-coal-line">
              <div className="h-full rounded-full bg-clay" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] text-ink-faint dark:text-coal-soft">{done}/{total}</span>
          </>
        ) : (
          <span className="flex items-center gap-1 text-xs text-ink-faint dark:text-coal-soft">
            <ListChecks className="h-3.5 w-3.5" /> checklist
          </span>
        )}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={288}>
        <ChecklistEditor rowId={rowId} column={column} value={value} />
      </Popover>
    </div>
  );
}

// The row drawer renders a checklist property as this full-width inline list
// (not the compact popover): the drawer has the room, and a checklist is the
// property you actually work in there.
export function ChecklistInline({ rowId, column, value }: { rowId: string; column: Column; value: CellValue }) {
  return (
    <div className="rounded-lg border border-paper-line px-2.5 py-2 dark:border-coal-line">
      <ChecklistEditor rowId={rowId} column={column} value={value} big />
    </div>
  );
}

// URL cell, a real clickable link in display mode, an editable input on focus.
// Click the anchor to open; the pencil drops into edit mode.
export function UrlCell({ rowId, column, value }: { rowId: string; column: Column; value: CellValue }) {
  const setCell = useData((s) => s.setCell);
  const [editing, setEditing] = useState(false);
  const url = typeof value === 'string' ? value : '';
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  if (editing || !url) {
    return (
      <input
        autoFocus={editing}
        value={url}
        onChange={(e) => setCell(rowId, column.id, e.target.value)}
        onBlur={() => setEditing(false)}
        placeholder="https://…"
        className="min-h-[38px] w-full bg-transparent px-2 py-2.5 text-xs text-ink outline-none focus:bg-clay-wash/40 dark:text-coal-text dark:focus:bg-clay/15"
      />
    );
  }
  return (
    <div className="flex min-h-[38px] w-full items-center gap-1 px-2">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate text-xs text-clay underline decoration-clay/40 underline-offset-2 hover:decoration-clay"
        title={href}
      >
        {url}
      </a>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 rounded p-1 text-ink-faint hover:text-clay"
        title="Edit link"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

// Default text cell. Plain text edits inline. A bare URL still gets an open-link
// chip; a labeled link (stored as markdown [label](href)) shows the label as a
// real link. The link button opens a small editor to set/replace/clear it.
export function TextCell({ rowId, column, value }: { rowId: string; column: Column; value: CellValue }) {
  const setCell = useData((s) => s.setCell);
  const text = typeof value === 'string' ? value : value === null ? '' : String(value);
  const link = parseCellLink(text);
  const bareUrl = !link && /^https?:\/\/\S+$/i.test(text.trim());

  const [editingLink, setEditingLink] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const saveLink = (label: string, href: string) =>
    setCell(rowId, column.id, href.trim() ? formatCellLink(label, href) : label.trim());

  const editor = (
    <LinkEditor
      open={editingLink}
      onClose={() => setEditingLink(false)}
      anchorRef={anchorRef}
      initial={link ?? { label: text, href: bareUrl ? text.trim() : '' }}
      onSave={saveLink}
      onRemove={() => setCell(rowId, column.id, link ? link.label : '')}
    />
  );

  // A set link reads as a link, not raw markdown, edit it through the popover.
  if (link) {
    return (
      <div ref={anchorRef} className="flex min-h-[38px] w-full items-center gap-1 px-2">
        <a
          href={linkHref(link.href)}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-xs text-clay underline decoration-clay/40 underline-offset-2 hover:decoration-clay"
          title={link.href}
        >
          {link.label}
        </a>
        <button
          type="button"
          onClick={() => setEditingLink(true)}
          className="shrink-0 rounded p-1 text-ink-faint hover:text-clay"
          title="Edit link"
        >
          <LinkIcon className="h-3 w-3" />
        </button>
        {editor}
      </div>
    );
  }

  return (
    <div ref={anchorRef} className="group/link flex min-h-[38px] w-full items-center">
      <input
        value={text}
        onChange={(e) => setCell(rowId, column.id, e.target.value)}
        className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-xs text-ink outline-none focus:bg-clay-wash/40 dark:text-coal-text dark:focus:bg-clay/15"
        placeholder="-"
      />
      {bareUrl && (
        <a
          href={text.trim()}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded p-1 text-ink-faint hover:text-clay"
          title="Open link"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      <button
        type="button"
        onClick={() => setEditingLink(true)}
        className="mr-1 shrink-0 rounded p-1 text-ink-faint opacity-0 hover:text-clay focus:opacity-100 group-hover/link:opacity-100 group-focus-within/link:opacity-100"
        title="Add link"
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </button>
      {editor}
    </div>
  );
}

// Small popover to set a cell's link: display text + URL, with remove. Empty URL
// + Save just writes the plain text back.
function LinkEditor({
  open,
  onClose,
  anchorRef,
  initial,
  onSave,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  initial: CellLink;
  onSave: (label: string, href: string) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [href, setHref] = useState(initial.href);

  // Seed the fields from the cell each time the editor opens.
  useEffect(() => {
    if (open) { setLabel(initial.label); setHref(initial.href); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => { onSave(label, href); onClose(); };

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} width={264}>
      <div className="space-y-1.5 p-1.5">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Text"
          className="w-full rounded-md border border-paper-line bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
        />
        <input
          value={href}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="https://…"
          className="w-full rounded-md border border-paper-line bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            className="flex-1 rounded-md bg-clay px-2 py-1.5 text-xs font-medium text-white hover:bg-clay-soft"
          >
            Save
          </button>
          {initial.href && (
            <button
              type="button"
              onClick={() => { onRemove(); onClose(); }}
              className="rounded-md px-2 py-1.5 text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </Popover>
  );
}

// Shared editor for select / multi-select options: pick (toggle), recolour from a
// palette, rename-by-readding, or delete. Used by both the single and multi cells
// so the management controls live in one place.
function SelectOptionList({
  tableId,
  column,
  selectedIds,
  onToggle,
}: {
  tableId: string;
  column: Column;
  selectedIds: string[];
  onToggle: (optionId: string) => void;
}) {
  const setColor = useData((s) => s.setSelectOptionColor);
  const removeOption = useData((s) => s.removeSelectOption);
  const addSelectOption = useData((s) => s.addSelectOption);
  const [draft, setDraft] = useState('');
  const [colorFor, setColorFor] = useState<string | null>(null);
  const options = column.options ?? [];

  return (
    <>
      {options.map((opt) => {
        const on = selectedIds.includes(opt.id);
        return (
          <div key={opt.id} className="group/opt mb-0.5">
            <div className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-paper-panel dark:hover:bg-coal-line">
              <button
                type="button"
                onClick={() => onToggle(opt.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <Check className={`h-3 w-3 shrink-0 ${on ? 'text-clay' : 'text-transparent'}`} />
                <span
                  className="inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                  style={{ backgroundColor: opt.color }}
                >
                  {opt.label}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setColorFor((c) => (c === opt.id ? null : opt.id))}
                title="Change colour"
                className="shrink-0 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span
                  className="block h-3.5 w-3.5 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                  style={{ backgroundColor: opt.color }}
                />
              </button>
              <button
                type="button"
                onClick={() => removeOption(tableId, column.id, opt.id)}
                title="Delete option"
                className="invisible shrink-0 rounded p-0.5 text-ink-faint hover:bg-rose-500/10 hover:text-rose-500 group-hover/opt:visible dark:text-coal-soft"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {colorFor === opt.id && (
              <div className="mt-0.5 grid grid-cols-7 gap-1 px-1 pb-1">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setColor(tableId, column.id, opt.id, c);
                      setColorFor(null);
                    }}
                    title={c}
                    style={{ backgroundColor: c }}
                    className={`h-5 w-5 rounded-full transition hover:scale-110 ${opt.color === c ? 'ring-2 ring-ink dark:ring-coal-text' : 'ring-1 ring-black/15 dark:ring-white/20'}`}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="mt-1 flex items-center gap-1 border-t border-paper-line pt-1 dark:border-coal-line">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const opt = addSelectOption(tableId, column.id, draft);
              if (opt) {
                onToggle(opt.id);
                setDraft('');
              }
            }
          }}
          placeholder="Add option…"
          className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-xs text-ink outline-none dark:text-coal-text"
        />
      </div>
    </>
  );
}

export function SelectCell({
  tableId,
  rowId,
  column,
  value,
}: {
  tableId: string;
  rowId: string;
  column: Column;
  value: CellValue;
}) {
  const setCell = useData((s) => s.setCell);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const options = column.options ?? [];
  const selected = options.find((o) => o.id === value) ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[38px] w-full items-center px-2 py-1 text-left"
      >
        {selected ? (
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
            style={{ backgroundColor: selected.color }}
          >
            {selected.label}
          </span>
        ) : (
          <span className="text-xs text-ink-faint dark:text-coal-soft">-</span>
        )}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={208}>
        {value && (
          <button
            type="button"
            onClick={() => {
              setCell(rowId, column.id, null);
              setOpen(false);
            }}
            className="mb-1 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-ink-faint hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <SelectOptionList
          tableId={tableId}
          column={column}
          selectedIds={value ? [value as string] : []}
          onToggle={(optionId) => {
            setCell(rowId, column.id, optionId);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

export function MultiSelectCell({
  tableId,
  rowId,
  column,
  value,
}: {
  tableId: string;
  rowId: string;
  column: Column;
  value: CellValue;
}) {
  const setCell = useData((s) => s.setCell);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const options: SelectOption[] = column.options ?? [];
  const selected: string[] = Array.isArray(value) ? value : [];
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setCell(rowId, column.id, next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[38px] w-full flex-wrap items-center gap-1 px-2 py-1 text-left"
      >
        {selected.length > 0 ? (
          selected.map((id) => {
            const opt = options.find((o) => o.id === id);
            if (!opt) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: opt.color }}
              >
                {opt.label}
              </span>
            );
          })
        ) : (
          <span className="text-xs text-ink-faint dark:text-coal-soft">-</span>
        )}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={208}>
        <SelectOptionList tableId={tableId} column={column} selectedIds={selected} onToggle={toggle} />
      </Popover>
    </div>
  );
}

export function PlaceCell({
  rowId,
  column,
  value,
}: {
  rowId: string;
  column: Column;
  value: CellValue;
}) {
  const setCell = useData((s) => s.setCell);
  const g = geoOf(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<GeoValue[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search the moment the picker opens, so keystrokes land in the field
  // and never in the editor behind it (which would replace the selected table).
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Basic name-only geocode (Open-Meteo), the fallback when the POI source has
  // nothing or is unreachable, so the picker always degrades to a usable pin.
  const geocodeBasic = async (q: string): Promise<GeoValue | null> => {
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`);
      const j = await r.json();
      const hit = j.results && j.results[0];
      if (!hit) return null;
      return { name: [hit.name, hit.country].filter(Boolean).join(', '), lat: hit.latitude, lon: hit.longitude };
    } catch {
      return null;
    }
  };

  // Live search: as you type (debounced), no Enter needed.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setError('');
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    setError('');
    const t = setTimeout(async () => {
      const pois = await searchPois(q);
      if (!alive) return;
      if (pois.length) {
        setResults(pois.slice(0, 8).map(poiToGeo));
      } else {
        const basic = await geocodeBasic(q);
        if (!alive) return;
        if (basic) setResults([basic]);
        else setError('No place found.');
      }
      setSearching(false);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  const choose = (geo: GeoValue) => {
    setCell(rowId, column.id, geo);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[38px] w-full items-center gap-1 px-2 py-1 text-left"
      >
        {g ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-xs text-ink dark:text-coal-text">
            <MapPin className="h-3 w-3 shrink-0 text-clay" />
            <span className="truncate">{g.name}</span>
            {categoryLabel(g) && (
              <span className="shrink-0 text-ink-faint dark:text-coal-soft">· {categoryLabel(g)}</span>
            )}
          </span>
        ) : (
          <span className="text-xs text-ink-faint dark:text-coal-soft">-</span>
        )}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={272}>
        <div className="flex items-center gap-1.5 rounded-md border border-paper-line bg-paper px-2 dark:border-coal-line dark:bg-coal">
          <Search className="h-3.5 w-3.5 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) choose(results[0]);
            }}
            placeholder="Search a place…"
            className="flex-1 bg-transparent py-1.5 text-xs text-ink outline-none dark:text-coal-text"
          />
          {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" />}
        </div>
        {error && <p className="mt-1 px-1 text-[11px] text-red-500">{error}</p>}

        {results.length > 0 && (
          <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
            {results.map((r, i) => (
              <button
                key={`${r.lat},${r.lon},${i}`}
                type="button"
                onClick={() => choose(r)}
                className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-paper-panel dark:hover:bg-coal-line"
              >
                <span className="flex items-center gap-1 text-xs font-medium text-ink dark:text-coal-text">
                  <MapPin className="h-3 w-3 shrink-0 text-clay" />
                  <span className="truncate">{r.name}</span>
                </span>
                {r.address && (
                  <span className="truncate pl-4 text-[10px] leading-tight text-ink-faint/80 dark:text-coal-soft/80">{r.address}</span>
                )}
                {categoryLabel(r) && (
                  <span className="truncate pl-4 text-[10px] text-ink-faint dark:text-coal-soft">{categoryLabel(r)}</span>
                )}
                {r.openingHours && (
                  <span className="flex items-center gap-1 truncate pl-4 text-[10px] text-ink-faint dark:text-coal-soft">
                    <Clock className="h-2.5 w-2.5" /> {r.openingHours}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Saved place, its OSM details + outbound link, and a clear action. */}
        {g && results.length === 0 && !searching && (
          <div className="mt-1 space-y-1 border-t border-paper-line px-1 pt-1.5 dark:border-coal-line">
            {g.openingHours && (
              <p className="flex items-start gap-1.5 text-[11px] text-ink-soft dark:text-coal-soft">
                <Clock className="mt-0.5 h-3 w-3 shrink-0 text-ink-faint" /> {g.openingHours}
              </p>
            )}
            {g.website && (
              <a
                href={g.website}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 truncate text-[11px] text-clay hover:underline"
              >
                <Globe className="h-3 w-3 shrink-0" /> {g.website.replace(/^https?:\/\//, '')}
              </a>
            )}
            {g.address && <p className="text-[11px] text-ink-faint dark:text-coal-soft">{g.address}</p>}
            <button
              type="button"
              onClick={() => {
                setCell(rowId, column.id, null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}

// Number cell, shows a formatted value (¥, kr, %, thousands), click to edit raw.
export function NumberCell({ rowId, column, value }: { rowId: string; column: Column; value: CellValue }) {
  const setCell = useData((s) => s.setCell);
  const numStyle = useWorkspace((s) => s.numberStyle());
  const [editing, setEditing] = useState(false);
  // Local draft so a Swedish comma decimal ("12,50") can be typed without the
  // controlled value clobbering the half-typed "12," each keystroke.
  const [draft, setDraft] = useState<string | null>(null);
  const has = value !== null && value !== undefined && value !== '';
  const fmt = column.numberFormat ?? 'plain';

  if (editing || fmt === 'plain') {
    const n = typeof value === 'number' ? value : has ? coerceNumber(value) : 0;
    const step = (delta: number) => setCell(rowId, column.id, n + delta);
    const commit = (raw: string) => {
      if (raw.trim() === '') setCell(rowId, column.id, null);
      else {
        const parsed = parseLocaleNumber(raw, numStyle);
        if (Number.isFinite(parsed)) setCell(rowId, column.id, parsed);
      }
    };
    // Digits are right-aligned, so the +/- stepper floats in the empty left
    // gutter on hover/focus and never covers the value. The browser's native
    // spinners (which did overlap) are removed globally in index.css.
    return (
      <div className="group/num relative flex min-h-[38px] w-full items-center">
        <input
          type="text"
          inputMode="decimal"
          autoFocus={editing}
          value={draft ?? (has ? String(value) : '')}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value); // live update where the value isn't mid-typed
          }}
          onBlur={() => {
            if (draft != null) commit(draft);
            setDraft(null);
            setEditing(false);
          }}
          className="min-h-[38px] w-full bg-transparent px-2 py-2.5 text-right font-mono text-xs text-ink outline-none focus:bg-clay-wash/40 dark:text-coal-text dark:focus:bg-clay/15"
        />
        <div className="pointer-events-none absolute inset-y-0 left-1 hidden items-center gap-0.5 group-hover/num:flex group-focus-within/num:flex">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(-1)}
            className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded border border-paper-line bg-paper text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft"
            title="Decrease"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(1)}
            className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded border border-paper-line bg-paper text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft"
            title="Increase"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex min-h-[38px] w-full items-center justify-end px-2 py-2.5 text-right font-mono text-xs text-ink hover:bg-clay-wash/30 dark:text-coal-text dark:hover:bg-clay/10"
    >
      {has ? formatValue(Number(value), fmt) : <span className="text-ink-faint dark:text-coal-soft">-</span>}
    </button>
  );
}

// Relation cell, links to rows in another table. Stores an array of row ids.
export function RelationCell({ rowId, column, value }: { rowId: string; column: Column; value: CellValue }) {
  const setCell = useData((s) => s.setCell);
  const openRow = useData((s) => s.openRow);
  const targetTable = useData((s) => (column.relationTableId ? s.tables[column.relationTableId] : undefined));
  const allRows = useData((s) => s.rows);
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!column.relationTableId || !targetTable) {
    return <div className="min-h-[38px] px-2 py-2.5 text-xs text-ink-faint dark:text-coal-soft">Set a target table →</div>;
  }

  const titleCol = targetTable.columns[0];
  const labelOf = (rid: string): string => {
    const r = allRows[rid];
    if (!r) return '(deleted)';
    const v = r.cells[titleCol?.id ?? ''];
    return (typeof v === 'string' && v) || 'Untitled';
  };
  const candidates = Object.values(allRows)
    .filter((r) => r.table === column.relationTableId)
    .filter((r) => labelOf(r.id).toLowerCase().includes(query.toLowerCase()));
  const toggle = (rid: string) => {
    const next = ids.includes(rid) ? ids.filter((x) => x !== rid) : [...ids, rid];
    setCell(rowId, column.id, next);
  };

  return (
    <div ref={ref} className="relative">
      {/* A plain div, not a button: the chips below are real buttons, and nesting
          a clickable element in a button double-fired (the chip and the button),
          which opened the linked row twice. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[38px] w-full cursor-pointer flex-wrap items-center gap-1 px-2 py-2 text-left"
      >
        {ids.length === 0 && <span className="text-xs text-ink-faint dark:text-coal-soft">-</span>}
        {ids.map((rid) => (
          <button
            type="button"
            key={rid}
            onClick={(e) => {
              e.stopPropagation();
              openRow(rid);
            }}
            className="inline-flex max-w-[140px] items-center gap-1 truncate rounded bg-clay-wash px-1.5 py-0.5 text-[11px] text-clay hover:underline dark:bg-clay/15 dark:text-clay-soft"
          >
            <Link2 className="h-3 w-3 shrink-0" /> {labelOf(rid)}
          </button>
        ))}
      </div>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={264}>
          <div className="mb-1 flex items-center gap-1.5 rounded-md border border-paper-line bg-paper px-2 dark:border-coal-line dark:bg-coal">
            <Search className="h-3.5 w-3.5 text-ink-faint" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Link a ${targetTable.name} row…`}
              className="flex-1 bg-transparent py-1.5 text-xs text-ink outline-none dark:text-coal-text"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {candidates.length === 0 && <p className="px-2 py-2 text-xs text-ink-faint dark:text-coal-soft">No rows.</p>}
            {candidates.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r.id)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <span className="truncate">{labelOf(r.id)}</span>
                {ids.includes(r.id) && <X className="h-3 w-3 shrink-0 text-clay" />}
              </button>
            ))}
          </div>
        </Popover>
    </div>
  );
}

// A colour-coded initials chip standing in for an avatar (we have no avatar
// storage). Colour is keyed off the id so a person looks the same everywhere.
export function Avatar({ id, name, size = 18 }: { id: string; name: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: avatarColor(id), fontSize: Math.round(size * 0.42) }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function PersonChip({ id, name }: { id: string; name: string }) {
  return (
    <span className="inline-flex max-w-[150px] items-center gap-1 truncate rounded-full bg-paper-panel py-0.5 pl-0.5 pr-1.5 text-[11px] text-ink-soft dark:bg-coal-line dark:text-coal-soft">
      <Avatar id={id} name={name} />
      <span className="truncate">{name}</span>
    </span>
  );
}

// Person cell, assign one or more workspace members. Ids live in the existing
// `cells` JSON (a `string[]`), so there's no new collection. Single columns
// replace on pick; multi columns toggle. A stored id that no longer resolves to
// a member renders as a muted "unknown" chip rather than crashing.
export function PersonCell({ rowId, column, value }: { rowId: string; column: Column; value: CellValue }) {
  const setCell = useData((s) => s.setCell);
  const members = useMembers();
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const multi = column.peopleMulti === true;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Unknown';
  const candidates = members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));

  const pick = (id: string) => {
    if (multi) {
      setCell(rowId, column.id, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    } else {
      // Single: re-picking the current assignee clears it; otherwise replace.
      setCell(rowId, column.id, ids.includes(id) ? [] : [id]);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[38px] w-full flex-wrap items-center gap-1 px-2 py-1.5 text-left"
      >
        {ids.length === 0 && <span className="text-xs text-ink-faint dark:text-coal-soft">-</span>}
        {ids.map((id) => (
          <PersonChip key={id} id={id} name={nameOf(id)} />
        ))}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={232}>
        <div className="mb-1 flex items-center gap-1.5 rounded-md border border-paper-line bg-paper px-2 dark:border-coal-line dark:bg-coal">
          <Search className="h-3.5 w-3.5 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Assign a member…"
            className="flex-1 bg-transparent py-1.5 text-xs text-ink outline-none dark:text-coal-text"
          />
        </div>
        <div className="max-h-52 overflow-y-auto">
          {candidates.length === 0 && (
            <p className="px-2 py-2 text-xs text-ink-faint dark:text-coal-soft">No members.</p>
          )}
          {candidates.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pick(m.id)}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-paper-panel dark:hover:bg-coal-line"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Avatar id={m.id} name={m.name} />
                <span className="truncate text-xs text-ink dark:text-coal-text">{m.name}</span>
              </span>
              {ids.includes(m.id) && <X className="h-3 w-3 shrink-0 text-clay" />}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

// Rollup cell, aggregates a number column from related rows. Read-only.
export function RollupCell({ tableId, rowId, column }: { tableId: string; rowId: string; column: Column }) {
  const thisTable = useData((s) => s.tables[tableId]);
  const thisRow = useData((s) => s.rows[rowId]);
  const rowsMap = useData((s) => s.rows);
  const fmt = column.numberFormat ?? 'plain';
  const relCol = thisTable?.columns.find((c) => c.id === column.rollupRelationColumnId);

  if (!relCol || !column.rollupTargetColumnId) {
    return <div className="min-h-[38px] px-2 py-2.5 text-right text-xs text-ink-faint dark:text-coal-soft">Configure →</div>;
  }

  const relIds = Array.isArray(thisRow?.cells[relCol.id]) ? (thisRow!.cells[relCol.id] as string[]) : [];
  const nums: number[] = [];
  for (const rid of relIds) {
    const r = rowsMap[rid];
    if (!r) continue;
    const v = r.cells[column.rollupTargetColumnId];
    if (typeof v === 'number') nums.push(v);
    else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) nums.push(Number(v));
  }
  const fn = column.rollupFn ?? 'sum';
  let out = 0;
  if (fn === 'count') out = relIds.length;
  else if (nums.length === 0) out = 0;
  else if (fn === 'sum') out = nums.reduce((a, b) => a + b, 0);
  else if (fn === 'avg') out = nums.reduce((a, b) => a + b, 0) / nums.length;
  else if (fn === 'min') out = Math.min(...nums);
  else out = Math.max(...nums);

  return (
    <div
      className="min-h-[38px] px-2 py-2.5 text-right font-mono text-xs text-ink dark:text-coal-text"
      title={`${fn} of ${relCol.name} → ${column.rollupTargetColumnId}`}
    >
      {formatValue(out, fmt)}
    </div>
  );
}

// Lookup cell, follows a relation and reads one column off the related rows.
// Read-only, derived; mirrors RollupCell but joins text instead of aggregating.
export function LookupCell({ tableId, rowId, column }: { tableId: string; rowId: string; column: Column }) {
  const thisTable = useData((s) => s.tables[tableId]);
  const thisRow = useData((s) => s.rows[rowId]);
  const tables = useData((s) => s.tables);
  const rowsMap = useData((s) => s.rows);
  const members = useMembers();
  const relCol = thisTable?.columns.find((c) => c.id === column.lookupRelationColumnId && c.type === 'relation');

  if (!relCol || !column.lookupTargetColumnId) {
    return <div className="min-h-[38px] px-2 py-2.5 text-xs text-ink-faint dark:text-coal-soft">Configure →</div>;
  }

  const text = thisTable ? resolveLookup(thisRow, thisTable.columns, column, tables, rowsMap, members) : '';
  return (
    <div className="min-h-[38px] px-2 py-2.5 text-xs text-ink-soft dark:text-coal-soft" title="Looked up across a relation">
      {text || <span className="text-ink-faint dark:text-coal-soft">-</span>}
    </div>
  );
}

// Progress cell, a % bar. Either a manual 0–100 number, or auto-computed from
// linked sub-tasks (a relation column + a "done" checkbox column in the target).
export function ProgressCell({ tableId, rowId, column, value }: { tableId: string; rowId: string; column: Column; value: CellValue }) {
  const setCell = useData((s) => s.setCell);
  const thisTable = useData((s) => s.tables[tableId]);
  const thisRow = useData((s) => s.rows[rowId]);
  const rowsMap = useData((s) => s.rows);
  const [editing, setEditing] = useState(false);

  const relCol = thisTable?.columns.find((c) => c.id === column.rollupRelationColumnId && c.type === 'relation');
  const auto = !!(relCol && column.rollupTargetColumnId);

  let pct: number;
  if (auto) {
    const relIds = Array.isArray(thisRow?.cells[relCol!.id]) ? (thisRow!.cells[relCol!.id] as string[]) : [];
    const total = relIds.length;
    const done = relIds.filter((rid) => rowsMap[rid]?.cells[column.rollupTargetColumnId!] === true).length;
    pct = total ? Math.round((done / total) * 100) : 0;
  } else {
    const n = typeof value === 'number' ? value : Number(value);
    pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  }

  if (editing && !auto) {
    return (
      <input
        type="number"
        min={0}
        max={100}
        autoFocus
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(e) => setCell(rowId, column.id, e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value))))}
        onBlur={() => setEditing(false)}
        className="min-h-[38px] w-full bg-transparent px-2 py-2.5 text-right font-mono text-xs text-ink outline-none focus:bg-clay-wash/40 dark:text-coal-text"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => !auto && setEditing(true)}
      className={`flex min-h-[38px] w-full items-center gap-2 px-2 py-2.5 ${auto ? 'cursor-default' : ''}`}
      title={auto ? 'Auto from linked sub-tasks' : 'Click to set 0–100'}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-line dark:bg-coal-line">
        <div className="h-full rounded-full bg-clay transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-soft dark:text-coal-soft">{pct}%</span>
    </button>
  );
}

// Button cell, runs its configured actions on this row when clicked.
export function ButtonCell({ rowId, column }: { rowId: string; column: Column }) {
  const setCell = useData((s) => s.setCell);
  const [flash, setFlash] = useState(false);
  const label = column.buttonLabel || 'Run';
  const actions = column.buttonActions ?? [];
  const run = () => {
    const updates = applyActions(actions, new Date());
    for (const [cid, v] of Object.entries(updates)) setCell(rowId, cid, v);
    setFlash(true);
    setTimeout(() => setFlash(false), 500);
  };
  return (
    <div className="flex min-h-[38px] items-center px-2 py-1.5">
      <button
        type="button"
        onClick={run}
        disabled={actions.length === 0}
        className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-40 ${flash ? 'bg-green-600' : 'bg-clay hover:bg-clay/90'}`}
        title={actions.length ? 'Run actions' : 'Configure actions in the column menu'}
      >
        <Zap className="h-3 w-3" /> {flash ? 'Done' : label}
      </button>
    </div>
  );
}

// Attachment cell, one file per cell. Two ways in, because the old one had a hard
// ~1.5 MB ceiling that a phone photo or any video blew straight through:
//   - Upload: goes to the `uploads` collection through the same staging modal the
//     Files tab uses, so images shrink and video transcodes before it is sent, and
//     the cell stores the URL. This is what lifts the cap to the server's 100 MB.
//   - From this page: reuse a file already attached to the page you are on, no
//     second copy on disk.
// A tiny file still falls back to the inline base64 path when there is no uploads
// collection, so nothing breaks on an install without it.
//
// TRADE-OFF, deliberate and worth knowing: an uploaded file lives in server-readable
// storage, exactly like body images and /audio already do. The inline path was the
// last thing in a row that stayed inside the encrypted cell JSON. Small files still
// take it; anything you upload here is no longer end-to-end encrypted.
export function AttachmentCell({ rowId, column, value }: { rowId: string; column: Column; value: CellValue }) {
  const setCell = useData((s) => s.setCell);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [staged, setStaged] = useState<File[] | null>(null);
  const [busy, setBusy] = useState(false);
  const att = attachmentOf(value);

  // Files already on the page you are looking at, so a ticket attached to the page
  // can be pointed at from a row without uploading it twice.
  const activePageId = useData((s) => s.activePageId);
  const pages = useData((s) => s.pages);
  const allTables = useData((s) => s.tables);
  const rows = useData((s) => s.rows);
  const onPage = useMemo(() => {
    const page = activePageId ? pages[activePageId] : null;
    if (!page) return [];
    return collectMedia(page, pageTables(page, Object.values(allTables)), rows);
  }, [activePageId, pages, allTables, rows]);
  // The store holds an encrypted page's body as an envelope and this cell is far too
  // deep to be handed the decrypted copy, so collectMedia legitimately finds nothing.
  // Say which it is: "nothing here" and "can't look" are different answers.
  const pageLocked = isEnvelope(activePageId ? pages[activePageId]?.content : null);

  const store = (name: string, mime: string, size: number, data: string) =>
    setCell(rowId, column.id, { name, mime, size, data });

  // The modal hands back the (already compressed) files; upload the first one.
  const upload = async (files: File[]) => {
    const file = files[0];
    setStaged(null);
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadsApi.upload(file);
      if (url) {
        store(file.name, file.type, file.size, url);
        return;
      }
      // No uploads collection: the inline path, which has its own honest cap.
      const a = await processAttachmentFile(file);
      setCell(rowId, column.id, a);
    } catch (err) {
      toast(err instanceof FileTooLargeError ? err.message : 'Could not attach that file.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={anchorRef} className="flex min-h-[38px] items-center px-1.5 py-1">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setStaged([f]);
          e.target.value = ''; // allow re-picking the same file
        }}
      />
      {att ? (
        <span className="flex min-w-0 items-center gap-1">
          <a
            href={att.data}
            download={att.name}
            className="flex min-w-0 items-center gap-1 rounded-md border border-paper-line bg-paper-panel/60 px-1.5 py-0.5 text-[11px] text-ink hover:border-clay/50 dark:border-coal-line dark:bg-coal dark:text-coal-text"
            title={`Download ${att.name}`}
          >
            <Paperclip className="h-3 w-3 shrink-0 text-clay" />
            <span className="max-w-[8rem] truncate">{att.name}</span>
            <span className="shrink-0 text-ink-faint dark:text-coal-soft">{formatBytes(att.size)}</span>
          </a>
          <button
            type="button"
            onClick={() => setCell(rowId, column.id, null)}
            className="shrink-0 rounded p-0.5 text-ink-faint hover:text-clay"
            title="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          disabled={busy}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-faint hover:text-clay disabled:opacity-60 dark:text-coal-soft"
          title="Attach a file"
        >
          <Paperclip className="h-3 w-3" /> {busy ? 'Adding…' : 'Attach'}
        </button>
      )}

      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={anchorRef} width={260}>
        <div className="py-1">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              inputRef.current?.click();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
          >
            <Upload className="h-3.5 w-3.5 text-clay" />
            <span className="min-w-0 flex-1">Upload a file</span>
          </button>
          <div className="border-t border-paper-line px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint dark:border-coal-line dark:text-coal-soft">
            On this page
          </div>
          {pageLocked ? (
            <p className="px-3 pb-2 text-[11px] text-ink-faint dark:text-coal-soft">
              This page is encrypted, so its files can't be listed here. Uploading still works.
            </p>
          ) : onPage.length === 0 ? (
            <p className="px-3 pb-2 text-[11px] text-ink-faint dark:text-coal-soft">Nothing attached to this page yet.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto pb-1">
              {onPage.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    store(m.name, m.mime, m.size, m.url);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                  title={m.name}
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-clay" />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="shrink-0 text-[10px] text-ink-faint dark:text-coal-soft">{m.source}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Popover>

      {staged && <UploadModal files={staged} onCancel={() => setStaged(null)} onUpload={(f) => void upload(f)} />}
    </div>
  );
}
