// Import a board out of Trello, Todoist or Google Keep.
//
// All three land on the SAME target: the KanbanBundle that `lib/kanbanIO.ts`
// already imports. That is the whole design. The importer that turns a bundle
// into a real table, page and board is proven and has an upsert path; writing a
// second one per service would be three new ways to lose data. So each parser
// here does exactly one job, shape-shifting a foreign export into a bundle, and
// then stops.
//
// Pure: JSON text in, bundle out, no store, no network. Every parser is
// forgiving, reports what it could not use, and never invents a value.

import type { KanbanBundle, KanbanBundleColumn, KanbanBundleCard } from './kanbanIO';

export type BoardSource = 'trello' | 'todoist' | 'keep';

export interface BoardImport {
  bundle: KanbanBundle | null;
  /** Cards read. */
  count: number;
  /** Items that carried nothing usable, told to the user rather than swallowed. */
  skipped: number;
  problem?: string;
}

const STAGE: KanbanBundleColumn = { name: 'Stage', type: 'select', isStage: true, options: [] };

/** Does this list name mean "finished"? Real boards decorate their lists, and the
 *  decoration is the whole name to a plain string compare: an export whose list is
 *  called "✅ Done" would come in as an ordinary stage and the board would have
 *  no done column at all. So strip everything that is not a letter first, which
 *  drops emoji, spaces and punctuation and leaves "Done". */
function meansDone(label: string): boolean {
  return /^(done|complete|completed|finished|archive|archived)$/i.test(label.replace(/[^\p{L}]/gu, ''));
}

/** Build the bundle every parser returns, with the stage options in the order
 *  they were seen so the board reads left to right the way it did in the source. */
function bundle(title: string, stages: string[], cards: KanbanBundleCard[], extra: KanbanBundleColumn[] = []): KanbanBundle {
  return {
    waypointKanban: 1,
    title,
    columns: [
      { name: 'Title', type: 'text' },
      { ...STAGE, options: stages.map((s) => ({ label: s, ...(meansDone(s) ? { done: true } : {}) })) },
      ...extra,
    ],
    cards,
  };
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Trello's JSON board export: lists become stages, cards become cards. Archived
 *  ("closed") lists and cards are skipped rather than silently mixed in with live
 *  work, which is what makes a re-import match what you saw in Trello. */
export function parseTrello(text: string): BoardImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { bundle: null, count: 0, skipped: 0, problem: 'That is not valid JSON.' };
  }
  // JSON.parse("null") is valid JSON and gives null, which reads a property off
  // nothing and throws where every other input returns a reason.
  if (!parsed || typeof parsed !== 'object') {
    return { bundle: null, count: 0, skipped: 0, problem: 'That is not a Trello board export.' };
  }
  const raw = parsed as Record<string, unknown>;
  const lists = asArray(raw.lists) as Record<string, unknown>[];
  const cardsIn = asArray(raw.cards) as Record<string, unknown>[];
  if (!lists.length && !cardsIn.length) {
    return { bundle: null, count: 0, skipped: 0, problem: 'No Trello lists or cards in that file. Use Board menu > Print, export and share > Export as JSON.' };
  }

  const listName = new Map<string, string>();
  const stages: string[] = [];
  for (const l of lists) {
    if (l.closed === true) continue;
    const name = str(l.name) || 'List';
    listName.set(str(l.id), name);
    if (!stages.includes(name)) stages.push(name);
  }

  const cards: KanbanBundleCard[] = [];
  let skipped = 0;
  for (const c of cardsIn) {
    if (c.closed === true) {
      skipped++;
      continue;
    }
    const name = str(c.name).trim();
    if (!name) {
      skipped++;
      continue;
    }
    const stage = listName.get(str(c.idList)) ?? stages[0] ?? 'To do';
    const due = str(c.due).slice(0, 10);
    const labels = asArray(c.labels)
      .map((l) => str((l as Record<string, unknown>).name))
      .filter(Boolean);
    cards.push({
      cells: {
        Title: name,
        Stage: stage,
        ...(due ? { Due: due } : {}),
        ...(labels.length ? { Labels: labels.join(', ') } : {}),
      },
      ...(str(c.desc).trim() ? { body: str(c.desc).trim() } : {}),
    });
  }
  if (!cards.length) return { bundle: null, count: 0, skipped, problem: 'That board has no open cards in it.' };
  return {
    bundle: bundle(str(raw.name) || 'Trello board', stages.length ? stages : ['To do'], cards, [
      { name: 'Due', type: 'date' },
      { name: 'Labels', type: 'text' },
    ]),
    count: cards.length,
    skipped,
  };
}

/** Todoist's JSON export: projects become stages, tasks become cards. Completed
 *  tasks come through marked Done rather than dropped, because a Todoist export
 *  is often the only copy of what you finished. */
export function parseTodoist(text: string): BoardImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { bundle: null, count: 0, skipped: 0, problem: 'That is not valid JSON.' };
  }
  const obj = (raw ?? {}) as Record<string, unknown>;
  // Todoist ships several export shapes; accept a bare array of items too.
  const items = (Array.isArray(raw) ? raw : asArray(obj.items).length ? asArray(obj.items) : asArray(obj.tasks)) as Record<string, unknown>[];
  if (!items.length) return { bundle: null, count: 0, skipped: 0, problem: 'No Todoist tasks in that file.' };

  const projectName = new Map<string, string>();
  for (const p of asArray(obj.projects) as Record<string, unknown>[]) {
    projectName.set(str(p.id) || String(p.id ?? ''), str(p.name) || 'Project');
  }

  const stages: string[] = [];
  const cards: KanbanBundleCard[] = [];
  let skipped = 0;
  for (const t of items) {
    const content = str(t.content) || str(t.title);
    if (!content.trim()) {
      skipped++;
      continue;
    }
    const done = t.checked === true || t.checked === 1 || t.completed === true || !!t.completed_at;
    const project = projectName.get(str(t.project_id) || String(t.project_id ?? '')) ?? str(t.project) ?? 'Inbox';
    const stage = done ? 'Done' : project || 'Inbox';
    if (!stages.includes(stage)) stages.push(stage);
    const due = str((t.due as Record<string, unknown>)?.date) || str(t.due_date) || str(t.date);
    // Todoist priority is 4 = highest. Translated rather than passed through,
    // because a bare "4" on a card means nothing to anyone reading it later.
    const p = Number(t.priority);
    const priority = p === 4 ? 'High' : p === 3 ? 'Medium' : p === 2 ? 'Low' : '';
    cards.push({
      cells: {
        Title: content.trim(),
        Stage: stage,
        ...(due ? { Due: due.slice(0, 10) } : {}),
        ...(priority ? { Priority: priority } : {}),
      },
      ...(str(t.description).trim() ? { body: str(t.description).trim() } : {}),
    });
  }
  if (!cards.length) return { bundle: null, count: 0, skipped, problem: 'No usable tasks in that file.' };
  if (!stages.includes('Done')) stages.push('Done');
  return {
    bundle: bundle('Todoist', stages, cards, [
      { name: 'Due', type: 'date' },
      { name: 'Priority', type: 'select', options: [{ label: 'High' }, { label: 'Medium' }, { label: 'Low' }] },
    ]),
    count: cards.length,
    skipped,
  };
}

/**
 * Google Keep, from Takeout. Takeout writes ONE JSON file per note, so this
 * accepts either a single note or an array of them, which is what you get after
 * concatenating them or passing a folder through.
 *
 * A Keep note is either text or a checklist. A checklist becomes a card per item
 * (that is what the items ARE), and a text note becomes one card with the text as
 * its body. Pinned and archived come through as stages so the shape survives.
 */
export function parseKeep(text: string): BoardImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { bundle: null, count: 0, skipped: 0, problem: 'That is not valid JSON.' };
  }
  // A bare null or a number is valid JSON but not a note, and wrapping it in an
  // array would walk properties off nothing further down.
  if (!raw || typeof raw !== 'object') {
    return { bundle: null, count: 0, skipped: 0, problem: 'That is not a Keep export.' };
  }
  const notes = (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[];
  const cards: KanbanBundleCard[] = [];
  const stages: string[] = [];
  let skipped = 0;

  const stageFor = (n: Record<string, unknown>): string => {
    if (n.isArchived === true) return 'Archived';
    if (n.isPinned === true) return 'Pinned';
    return 'Notes';
  };

  for (const n of notes) {
    if (!n || typeof n !== 'object') {
      skipped++;
      continue;
    }
    const stage = stageFor(n);
    const title = str(n.title).trim();
    const list = asArray(n.listContent) as Record<string, unknown>[];

    if (list.length) {
      for (const item of list) {
        const t = str(item.text).trim();
        if (!t) {
          skipped++;
          continue;
        }
        if (!stages.includes(stage)) stages.push(stage);
        cards.push({
          cells: {
            Title: t,
            Stage: stage,
            Done: item.isChecked === true,
            ...(title ? { List: title } : {}),
          },
        });
      }
      continue;
    }

    const body = str(n.textContent).trim();
    if (!title && !body) {
      skipped++;
      continue;
    }
    if (!stages.includes(stage)) stages.push(stage);
    cards.push({
      cells: { Title: title || body.split('\n')[0].slice(0, 80), Stage: stage, Done: false },
      ...(body ? { body } : {}),
    });
  }

  if (!cards.length) return { bundle: null, count: 0, skipped, problem: 'No Keep notes in that file.' };
  return {
    bundle: bundle('Google Keep', stages, cards, [
      { name: 'Done', type: 'checkbox' },
      { name: 'List', type: 'text' },
    ]),
    count: cards.length,
    skipped,
  };
}

/** Guess which service a file came from, so the picker can be one button. Shape
 *  first, never the file name: an export renamed by the browser still works. */
export function detectBoardSource(text: string): BoardSource | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const first = Array.isArray(raw) ? (raw[0] as Record<string, unknown>) : (raw as Record<string, unknown>);
  if (!first || typeof first !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.cards) && Array.isArray(obj.lists)) return 'trello';
  if ('textContent' in first || 'listContent' in first || 'isArchived' in first) return 'keep';
  if (Array.isArray(obj.items) || Array.isArray(obj.projects) || 'content' in first) return 'todoist';
  return null;
}

export function parseBoard(text: string, source?: BoardSource): BoardImport {
  const kind = source ?? detectBoardSource(text);
  if (kind === 'trello') return parseTrello(text);
  if (kind === 'todoist') return parseTodoist(text);
  if (kind === 'keep') return parseKeep(text);
  return { bundle: null, count: 0, skipped: 0, problem: 'That does not look like a Trello, Todoist or Keep export.' };
}
