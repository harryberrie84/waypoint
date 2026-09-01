// Parse pasted JSON or CSV into records for the document widgets (recipe, case
// brief, statute). Flexible about key names (so a recipe site's JSON or a plain
// spreadsheet both work) and dependency-free, so it's testable. JSON may be a
// single object or an array (or wrap one under recipes/items/data).

import { parseDelimited } from './csv';

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(' ');
  return '';
}

// A list value: an array (of strings or {text}/{name} objects), or a string split
// on newlines or semicolons.
function toList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x : str((x as { text?: unknown; name?: unknown })?.text ?? (x as { name?: unknown })?.name ?? x)))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof v === 'string') return v.split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function pick(o: Record<string, unknown>, aliases: string[]): unknown {
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(o)) lower[k.toLowerCase().trim()] = o[k];
  for (const a of aliases) {
    const v = lower[a.toLowerCase()];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

// Normalise pasted text to a list of plain records.
function records(text: string): Record<string, unknown>[] {
  const t = text.trim();
  if (!t) return [];
  if (t[0] === '{' || t[0] === '[') {
    const json = JSON.parse(t) as unknown;
    const wrapped = Array.isArray(json)
      ? json
      : ((json as Record<string, unknown>).recipes ??
          (json as Record<string, unknown>).items ??
          (json as Record<string, unknown>).data ??
          [json]);
    const arr = Array.isArray(wrapped) ? wrapped : [wrapped];
    return arr.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  }
  const { headers, rows } = parseDelimited(t);
  return rows.map((cells) => {
    const o: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      o[h] = cells[i] ?? '';
    });
    return o;
  });
}

export interface RecipeRecord {
  title: string;
  servings: string;
  time: string;
  ingredients: string[];
  steps: string[];
}

export function parseRecipes(text: string): RecipeRecord[] {
  return records(text)
    .map((o) => ({
      title: str(pick(o, ['title', 'name'])),
      servings: str(pick(o, ['servings', 'serves', 'yield', 'recipeYield'])),
      time: str(pick(o, ['time', 'totaltime', 'total time', 'duration', 'cooktime', 'cook time'])),
      ingredients: toList(pick(o, ['ingredients', 'recipeingredient', 'ingredient'])),
      steps: toList(pick(o, ['steps', 'instructions', 'method', 'recipeinstructions', 'directions'])),
    }))
    .filter((r) => r.title || r.ingredients.length || r.steps.length);
}

export interface CaseRecord {
  title: string;
  court: string;
  year: string;
  citation: string;
  facts: string;
  issue: string;
  holding: string;
  reasoning: string;
  notes: string;
}

export function parseCaseBriefs(text: string): CaseRecord[] {
  return records(text)
    .map((o) => ({
      title: str(pick(o, ['title', 'case', 'name', 'casename', 'case name'])),
      court: str(pick(o, ['court'])),
      year: str(pick(o, ['year', 'date', 'decided'])),
      citation: str(pick(o, ['citation', 'cite', 'reporter'])),
      facts: str(pick(o, ['facts', 'fact'])),
      issue: str(pick(o, ['issue', 'issues', 'question'])),
      holding: str(pick(o, ['holding', 'ruling', 'decision', 'held'])),
      reasoning: str(pick(o, ['reasoning', 'rationale', 'analysis', 'reason'])),
      notes: str(pick(o, ['notes', 'note', 'comment', 'my notes'])),
    }))
    .filter((r) => r.title || r.facts || r.holding);
}

export interface StatuteRecord {
  act: string;
  section: string;
  summary: string;
  link: string;
}

export function parseStatutes(text: string): StatuteRecord[] {
  return records(text)
    .map((o) => ({
      act: str(pick(o, ['act', 'code', 'title', 'name', 'statute'])),
      section: str(pick(o, ['section', 'sec', 'number'])),
      summary: str(pick(o, ['summary', 'text', 'description', 'body'])),
      link: str(pick(o, ['link', 'url', 'source', 'href'])),
    }))
    .filter((r) => r.act || r.section || r.summary);
}
