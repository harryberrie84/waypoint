// Export the document widgets back out, and hand out blank fill-in templates, in
// the same shapes lib/recordImport reads. So a recipe you exported re-imports
// cleanly, and a downloaded template fills in and imports too.

import type { CaseRecord, RecipeRecord, StatuteRecord } from './recordImport';

interface Ingredient {
  text?: string;
}

export function recipeFromAttrs(a: Record<string, unknown>): RecipeRecord {
  const ing = Array.isArray(a.ingredients) ? (a.ingredients as Ingredient[]) : [];
  return {
    title: String(a.title ?? ''),
    servings: String(a.servings ?? ''),
    time: String(a.time ?? ''),
    ingredients: ing.map((i) => String(i?.text ?? '')).filter(Boolean),
    steps: Array.isArray(a.steps) ? (a.steps as string[]).filter(Boolean) : [],
  };
}

export function caseFromAttrs(a: Record<string, unknown>): CaseRecord {
  const g = (k: string) => String(a[k] ?? '');
  return { title: g('title'), court: g('court'), year: g('year'), citation: g('citation'), facts: g('facts'), issue: g('issue'), holding: g('holding'), reasoning: g('reasoning'), notes: g('notes') };
}

export function statuteFromAttrs(a: Record<string, unknown>): StatuteRecord {
  const g = (k: string) => String(a[k] ?? '');
  return { act: g('act'), section: g('section'), summary: g('summary'), link: g('link') };
}

export function toJSON(records: unknown): string {
  return JSON.stringify(records, null, 2);
}

function esc(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(headers: string[], rows: string[][]): string {
  return [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

export function recipesToCSV(recs: RecipeRecord[]): string {
  return csv(
    ['title', 'servings', 'time', 'ingredients', 'steps'],
    recs.map((r) => [r.title, r.servings, r.time, r.ingredients.join('; '), r.steps.join('; ')]),
  );
}

export function casesToCSV(recs: CaseRecord[]): string {
  return csv(
    ['title', 'court', 'year', 'citation', 'facts', 'issue', 'holding', 'reasoning', 'notes'],
    recs.map((r) => [r.title, r.court, r.year, r.citation, r.facts, r.issue, r.holding, r.reasoning, r.notes]),
  );
}

export function statutesToCSV(recs: StatuteRecord[]): string {
  return csv(['act', 'section', 'summary', 'link'], recs.map((r) => [r.act, r.section, r.summary, r.link]));
}

// --- Fill-in templates and worked examples ---------------------------------
// Two flavours per record kind, mirroring the Kanban board's blank + example:
//   BLANK    a one-record scaffold with PLACEHOLDER values, so it imports
//            cleanly (you see where each field lands) and you overwrite it. An
//            all-empty scaffold imported to nothing ("Nothing to import"), which
//            read as a broken template, hence the placeholders.
//   EXAMPLE  real, worked records that import as-is, to copy the shape from.
// Both JSON and CSV are derived from the SAME typed record arrays, so the two
// can't drift and each round-trips back through lib/recordImport. A list value
// (ingredients/steps) is an array in JSON and a "a; b; c" string in CSV; the
// importer reads both.

const BLANK_RECIPES: RecipeRecord[] = [
  { title: 'Recipe name', servings: '2', time: '30 min', ingredients: ['first ingredient', 'second ingredient'], steps: ['first step', 'second step'] },
];
const BLANK_CASES: CaseRecord[] = [
  { title: 'Case name', court: 'Court', year: 'Year', citation: 'Citation', facts: 'What happened', issue: 'The legal question', holding: 'What the court decided', reasoning: 'Why the court decided that', notes: 'Your own notes' },
];
const BLANK_STATUTES: StatuteRecord[] = [
  { act: 'Act or code name', section: 'Section', summary: 'What it says, in plain words', link: 'https://…' },
];

const EXAMPLE_RECIPES: RecipeRecord[] = [
  {
    title: 'Weeknight miso ramen',
    servings: '2',
    time: '25 min',
    ingredients: ['2 portions fresh ramen noodles', '3 tbsp white miso', '700ml chicken or veg stock', '2 tsp soy sauce', '1 tsp sesame oil', '2 soft-boiled eggs', '2 spring onions, sliced'],
    steps: ['Warm the stock, then whisk in the miso and soy off the boil.', 'Cook the noodles in a separate pot and drain.', 'Divide the noodles between bowls and pour over the broth.', 'Top each with a halved egg, spring onion and a drizzle of sesame oil.'],
  },
  {
    title: 'Tamagoyaki',
    servings: '2',
    time: '15 min',
    ingredients: ['4 eggs', '1 tbsp mirin', '1 tsp soy sauce', 'pinch of sugar', 'oil for the pan'],
    steps: ['Beat the eggs with the mirin, soy and sugar.', 'Oil a small pan over medium heat.', 'Add a thin layer, roll it up, push it aside and repeat with more egg.', 'Let it rest, then slice into thick pieces.'],
  },
];
const EXAMPLE_CASES: CaseRecord[] = [
  {
    title: 'Donoghue v Stevenson',
    court: 'House of Lords',
    year: '1932',
    citation: '[1932] AC 562',
    facts: 'A decomposed snail was found in an opaque bottle of ginger beer; the drinker fell ill.',
    issue: 'Does a manufacturer owe a duty of care to the ultimate consumer of its product?',
    holding: 'Yes. A duty of care is owed to persons so closely and directly affected by the act.',
    reasoning: 'The neighbour principle: take reasonable care to avoid acts you can foresee would injure your neighbour.',
    notes: 'Foundation of the modern law of negligence.',
  },
];
const EXAMPLE_STATUTES: StatuteRecord[] = [
  { act: 'Consumer Rights Act 2015', section: 's. 9', summary: 'Goods must be of satisfactory quality.', link: 'https://www.legislation.gov.uk/ukpga/2015/15/section/9' },
  { act: 'Consumer Rights Act 2015', section: 's. 11', summary: 'Goods must match their description.', link: 'https://www.legislation.gov.uk/ukpga/2015/15/section/11' },
];

export const BLANK_JSON: Record<string, string> = {
  recipe: toJSON(BLANK_RECIPES),
  case: toJSON(BLANK_CASES),
  statute: toJSON(BLANK_STATUTES),
};

export const BLANK_CSV: Record<string, string> = {
  recipe: recipesToCSV(BLANK_RECIPES),
  case: casesToCSV(BLANK_CASES),
  statute: statutesToCSV(BLANK_STATUTES),
};

export const EXAMPLE_JSON: Record<string, string> = {
  recipe: toJSON(EXAMPLE_RECIPES),
  case: toJSON(EXAMPLE_CASES),
  statute: toJSON(EXAMPLE_STATUTES),
};

export const EXAMPLE_CSV: Record<string, string> = {
  recipe: recipesToCSV(EXAMPLE_RECIPES),
  case: casesToCSV(EXAMPLE_CASES),
  statute: statutesToCSV(EXAMPLE_STATUTES),
};

export function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
