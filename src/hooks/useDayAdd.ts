import { useMemo, useRef, useState } from 'react';
import { useData } from '../store/useData';
import { firstDateColumn } from '../lib/tableQuery';
import type { Column, TableData } from '../types';

// Making a dated row from a day surface: the Calendar grid's day cells, the
// Itinerary rail's day headers. Shared so the two tabs cannot drift on the rules
// that matter here.
//
// Page-scoped by construction: the caller passes the tables ON THIS page and this
// never looks at the workspace: a page tab reflects THAT page, never the whole
// workspace, and that is the invariant this exists to hold. A page
// whose body we cannot read yields no tables, so no targets, so no add button, which
// is the honest outcome: guessing a table is how a row lands somewhere it does not
// belong.
//
// Encryption needs no special case. addRow does the encrypting and the workspace
// stamping, so an encrypted workspace behaves exactly like a plaintext one, and this
// is create-only, so no existing row can be altered or lost by it.

export interface DayAddTarget {
  table: TableData;
  col: Column;
}

export function useDayAdd(tables: TableData[]) {
  const addRow = useData((s) => s.addRow);
  const openRow = useData((s) => s.openRow);

  const targets = useMemo<DayAddTarget[]>(
    () =>
      tables
        .map((t) => ({ table: t, col: firstDateColumn(t.columns) }))
        .filter((x): x is DayAddTarget => !!x.col),
    [tables],
  );

  const [day, setDay] = useState<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  const create = async (dayIso: string, tableId: string, colId: string, withTime: boolean) => {
    setDay(null);
    // A datetime column needs a time part or the cell reads as empty. Midday is the
    // least surprising default for "something happens this day, time to be decided".
    const id = await addRow(tableId, { [colId]: withTime ? `${dayIso}T12:00` : dayIso });
    if (id) openRow(id); // straight into the drawer to type the title
  };

  /** One dated table: create now. Several: open the picker anchored to `el`. */
  const start = (dayIso: string, el: HTMLElement) => {
    if (targets.length === 0) return;
    if (targets.length === 1) {
      const { table, col } = targets[0];
      void create(dayIso, table.id, col.id, col.type === 'datetime');
      return;
    }
    anchor.current = el;
    setDay(dayIso);
  };

  return { targets, day, setDay, anchor, create, start };
}
