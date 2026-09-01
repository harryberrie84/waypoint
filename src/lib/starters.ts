// ---------------------------------------------------------------------------
// Starters, ready-made first pages for a fresh account.
// ---------------------------------------------------------------------------
// A blank editor is the wall non-Notion people bounce off, so a new account
// picks one of these and lands on populated, editable content. Each builder
// returns a plain TipTap doc (or null for a blank page); no tables, so the doc
// stands alone without a backing record. Keep the copy plain and short.

import type { DocNode } from './capture';

const p = (text = ''): DocNode => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const h = (level: number, text: string): DocNode => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const check = (text: string): DocNode => ({
  type: 'taskItem',
  attrs: { checked: false },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const checklist = (items: string[]): DocNode => ({ type: 'taskList', content: items.map(check) });
const bullets = (items: string[]): DocNode => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [p(t)] })),
});
const doc = (...nodes: DocNode[]): DocNode => ({ type: 'doc', content: nodes });

// Concert widgets, pre-filled so the page is useful the moment it opens.
type SetLine = { kind: 'song' | 'banter' | 'segment'; text: string; sub?: string; mins?: number };
const setlist = (title: string, lines: SetLine[]): DocNode => ({
  type: 'setlistBlock',
  attrs: { title, items: lines.map((l, i) => ({ id: `s${i + 1}`, ...l })) },
});
type QuizLine = { text: string; answer: string; options?: string[] };
const quiz = (title: string, qs: QuizLine[]): DocNode => ({
  type: 'quizBlock',
  attrs: { title, items: qs.map((q, i) => ({ id: `q${i + 1}`, options: [], ...q })) },
});

export interface Starter {
  key: string;
  label: string; // button label in the picker
  icon: string;
  title: string; // the page title
  build: () => DocNode | null; // null = empty page
}

export const STARTERS: Starter[] = [
  {
    key: 'groceries',
    label: 'grocery list',
    icon: '🛒',
    title: 'Groceries',
    build: () => doc(checklist(['milk', 'eggs', 'bread', 'coffee', 'fruit', 'something for dinner'])),
  },
  {
    key: 'meals',
    label: 'weekly meals',
    icon: '🍽️',
    title: 'Meals this week',
    build: () => doc(bullets(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])),
  },
  {
    key: 'todos',
    label: 'to-dos',
    icon: '✅',
    title: 'To-dos',
    build: () => doc(checklist(['', '', ''])),
  },
  {
    key: 'trip',
    label: 'a trip',
    icon: '✈️',
    title: 'Trip',
    build: () =>
      doc(
        h(2, 'When'),
        p(),
        h(2, 'Where'),
        p(),
        h(2, 'Packing'),
        checklist(['passport', 'charger', 'clothes']),
        h(2, 'Notes'),
        p(),
      ),
  },
  {
    key: 'concert',
    label: 'concert night',
    icon: '🎸',
    title: 'Concert night',
    build: () =>
      doc(
        p('The plan for the night. Everything here is editable, type / to add more.'),
        setlist('Tonight’s set', [
          { kind: 'banter', text: 'Welcome everyone, so glad you came. Before we play, a quick quiz to break the ice...' },
          { kind: 'segment', text: 'Intro quiz', mins: 5 },
          { kind: 'song', text: 'Opening number', sub: 'everyone in', mins: 4 },
          { kind: 'banter', text: 'Quick story about this next one...' },
          { kind: 'song', text: 'Second song', sub: '', mins: 3 },
          { kind: 'banter', text: 'This one is for the colleagues in the back.' },
          { kind: 'song', text: 'Third song', sub: '', mins: 4 },
          { kind: 'segment', text: 'Thanks + last song' },
          { kind: 'song', text: 'Closer', sub: 'big finish', mins: 4 },
        ]),
        p(),
        h(2, 'The intro quiz'),
        p('Run this during the intro. Ask the room, take guesses, then hit reveal.'),
        quiz('Intro quiz', [
          { text: 'Which of us started the band?', answer: '', options: ['', '', ''] },
          { text: 'What year did we first play together?', answer: '' },
          { text: 'Name this opening riff (we’ll play a few seconds)', answer: '' },
        ]),
      ),
  },
  {
    key: 'blank',
    label: 'blank page',
    icon: '📝',
    title: 'Notes',
    build: () => null,
  },
];
