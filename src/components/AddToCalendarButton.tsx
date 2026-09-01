import { useEffect, useRef, useState } from 'react';
import { CalendarPlus, Download, ExternalLink } from 'lucide-react';
import { eventsToICS, googleCalUrl, isValidCalEvent, type CalEvent } from '../lib/ics';

// AddToCalendarButton, a drop-in "Add to calendar" control for any item that has a
// title + a date. Renders NOTHING unless at least one valid event is passed, so it
// auto-appears when both a text and a date are present and disappears if either goes.
// Offers a .ics download (works on iPhone, Mac, Windows, Android, Linux) and, for a
// single event, a Google Calendar link for browser users. Pure export: it drops the
// event into the OS calendar, it does not sync back.

function triggerDownload(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(s: string): string {
  return (s || 'event').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'event';
}

export function AddToCalendarButton({
  events,
  calName,
  label,
  compact = false,
  align = 'right',
  className = '',
}: {
  events: CalEvent[] | CalEvent;
  calName?: string; // the calendar name for a multi-event export
  label?: string; // button text (non-compact); defaults to "Add to calendar"
  compact?: boolean; // icon-only trigger, for tight rows
  align?: 'left' | 'right'; // which side the menu opens toward
  className?: string;
}) {
  const list = (Array.isArray(events) ? events : [events]).filter(isValidCalEvent);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (list.length === 0) return null;

  const single = list.length === 1 ? list[0] : null;
  const name = calName || (single ? single.title : 'Waypoint trip');
  const gcal = single ? googleCalUrl(single) : '';

  const onIcs = () => {
    triggerDownload(`${safeName(single ? single.title : name)}.ics`, eventsToICS(name, list));
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Add to calendar"
        className={
          compact
            ? 'flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-paper-panel hover:text-clay dark:text-coal-soft dark:hover:bg-coal-line'
            : 'flex items-center gap-1.5 rounded-md border border-paper-line px-2 py-1 text-xs font-medium text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft'
        }
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        {!compact && (label || 'Add to calendar')}
        {!compact && list.length > 1 && <span className="text-ink-faint">({list.length})</span>}
      </button>
      {open && (
        <div
          className={['absolute top-full z-40 mt-1 w-52 overflow-hidden rounded-lg border border-paper-line bg-paper shadow-xl dark:border-coal-line dark:bg-coal-panel', align === 'right' ? 'right-0' : 'left-0'].join(' ')}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={onIcs} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
            <Download className="h-3.5 w-3.5 shrink-0 text-clay" />
            Download .ics{list.length > 1 ? ` (${list.length})` : ''}
          </button>
          {gcal && (
            <a href={gcal} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-clay" />
              Google Calendar
            </a>
          )}
          <p className="border-t border-paper-line px-3 py-1.5 text-[10px] leading-snug text-ink-faint dark:border-coal-line dark:text-coal-soft">
            .ics adds to iPhone, Mac, Windows, Android and Linux calendars.
          </p>
        </div>
      )}
    </div>
  );
}
