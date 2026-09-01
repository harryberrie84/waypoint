import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import type { Editor, Range } from '@tiptap/core';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type ForwardedRef,
} from 'react';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Table as TableIcon,
  Columns3,
  Columns2,
  Lightbulb,
  Repeat,
  Calculator,
  Timer,
  ChevronRight,
  Sigma,
  Workflow,
  Blocks,
  PieChart,
  BarChart3,
  BarChartHorizontal,
  Hash,
  CalendarDays,
  GanttChartSquare,
  LayoutGrid,
  Coins,
  Map as MapIcon,
  BedDouble,
  NotebookPen,
  Route,
  Plane,
  Clock,
  CloudSun,
  Link2,
  Tv,
  CalendarClock,
  Minus,
  Image as ImageIcon,
  FileText,
  Paperclip,
  Wallet,
  Luggage,
  CalendarCheck,
  Vote,
  Gauge,
  FormInput,
  Zap,
  Dices,
  Dice5,
  Swords,
  ScrollText,
  UserRound,
  ChefHat,
  Scale,
  Landmark,
  GraduationCap,
  Receipt,
  CookingPot,
  ShoppingCart,
  Home,
  PiggyBank,
  Sparkles,
  Music2,
  Music,
  Images,
  Ticket,
  HelpCircle,
} from 'lucide-react';
import { useData, selectRowsForTable, selectWorkspaceTables } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { openCharacterForm } from '../store/useCharacterForm';
import { toast } from '../store/useToast';
import { getBaseCurrency, convert } from '../lib/fx';
import { parseHumanDate, humanDateLabel } from '../lib/humanDate';
import { evaluateFormula, formatFormulaValue } from '../lib/formula';
import { processImageFile, ImageTooLargeError, processAttachmentFile, FileTooLargeError } from '../lib/image';
import { uploadsApi } from '../lib/api';
import { rollDiceDetailed, formatRoll } from '../lib/dice';
import { sampleChartData } from './ChartBlock';
import { makeColumns } from './Columns';
import type { TablePreset } from '../lib/tableQuery';
import { defaultViewConfig } from '../lib/tableQuery';
import { defaultTiers } from '../lib/tierList';
import { defaultFxBoard } from '../lib/fxBoard';

// Insert a server-backed table preset, then embed it once we have its id.
// deleteRange synchronously removes the slash text; the async insert happens
// after the table record is created.
function insertColumns(editor: Editor, range: Range, count: number) {
  editor.chain().focus().deleteRange(range).insertContent(makeColumns(count)).run();
  // Drop the cursor into the first column so you can start typing there instead
  // of after the whole block.
  try {
    let inside = -1;
    editor.state.doc.descendants((node, pos) => {
      if (inside !== -1) return false;
      if (node.type.name === 'column' && pos >= range.from) inside = pos + 2; // inside its first paragraph
      return inside === -1;
    });
    if (inside !== -1) editor.commands.setTextSelection(inside);
  } catch {
    /* clicking into a column still works */
  }
}

function insertPresetTable(editor: Editor, range: Range, preset: TablePreset) {
  editor.chain().focus().deleteRange(range).run();
  void useData
    .getState()
    .createTablePreset(preset)
    .then((tableId) => {
      if (tableId) {
        editor.chain().focus().insertContent({ type: 'tableEmbed', attrs: { tableId } }).run();
      }
    });
}

// Budget = the expense grid plus a live settlement readout bound to the same table.
function insertBudget(editor: Editor, range: Range) {
  editor.chain().focus().deleteRange(range).run();
  void useData
    .getState()
    .createTablePreset('budget')
    .then((tableId) => {
      if (!tableId) return;
      editor
        .chain()
        .focus()
        .insertContent({ type: 'tableEmbed', attrs: { tableId } })
        .insertContent({ type: 'budgetSummary', attrs: { tableId, base: getBaseCurrency() } })
        .run();
    });
}

// Poll = a ballot bound to a one-column table (one row per option). The table is
// plumbing, so we drop the auto-seeded blank row and don't embed the grid.
function insertPoll(editor: Editor, range: Range) {
  editor.chain().focus().deleteRange(range).run();
  void useData
    .getState()
    .createTablePreset('poll')
    .then((tableId) => {
      if (!tableId) return;
      for (const r of selectRowsForTable(useData.getState().rows, tableId)) void useData.getState().deleteRow(r.id);
      editor.chain().focus().insertContent({ type: 'pollBlock', attrs: { tableId, mode: 'single' } }).run();
    });
}

// Campaign = the seven linked TTRPG tables, created in one shot, then embedded in
// order on the page (relations are live between them, see createCampaignBundle).
function insertCampaign(editor: Editor, range: Range) {
  editor.chain().focus().deleteRange(range).run();
  void useData
    .getState()
    .createCampaignBundle()
    .then((ids) => {
      if (!ids.length) return;
      let chain = editor.chain().focus();
      for (const tableId of ids) chain = chain.insertContent({ type: 'tableEmbed', attrs: { tableId } });
      chain.run();
    });
}

// Dynamic /roll:<expr>, evaluate a dice expression with a real rng and insert
// the breakdown inline. The preview in the menu is the *same* roll that gets
// inserted (computed once, closed over), so what you see is what you get.
function rollItems(exprPart: string): CommandItem[] {
  const spec = exprPart.trim() || '1d20';
  try {
    const inserted = formatRoll(spec, rollDiceDetailed(spec, Math.random));
    return [
      {
        title: `roll ${spec}`,
        subtitle: inserted,
        icon: Dices,
        keywords: ['roll', 'dice'],
        run: (editor, range) => {
          editor.chain().focus().deleteRange(range).insertContent(inserted).run();
        },
      },
    ];
  } catch {
    return [{ title: 'roll dice', subtitle: 'try /roll:2d6+3, /roll:1d20, /roll:4d6kh3', icon: Dices, keywords: ['roll', 'dice'], run: () => {} }];
  }
}

// Form = a row under the key's form table, rendered as a form. find-or-create so
// every /form:<key> shares (and ripples) one schema.
function insertForm(editor: Editor, range: Range, key: string) {
  editor.chain().focus().deleteRange(range).run();
  void (async () => {
    const data = useData.getState();
    const tableId = await data.findOrCreateFormTable(key);
    if (!tableId) return;
    const rowId = await data.addRow(tableId);
    if (!rowId) return;
    editor.chain().focus().insertContent({ type: 'formBlock', attrs: { tableId, rowId } }).run();
  })();
}

// Dynamic /form:<key> items, reuse an existing key's schema or create a new one,
// and suggest the keys already in use as you type.
function formItems(keyPart: string): CommandItem[] {
  const kp = keyPart.trim();
  // Only suggest form keys from the active workspace, not every workspace.
  const ws = useWorkspace.getState();
  const scoped = selectWorkspaceTables(useData.getState().tables, ws.activeWorkspaceId ?? ws.defaultWorkspaceId, ws.defaultWorkspaceId);
  const keys = [...new Set(scoped.map((t) => t.formKey).filter((k): k is string => !!k))];
  const make = (key: string, subtitle: string): CommandItem => ({
    title: `form: ${key}`,
    subtitle,
    icon: FormInput,
    keywords: ['form', key],
    run: (editor, range) => insertForm(editor, range, key),
  });
  const items: CommandItem[] = [];
  for (const k of keys) {
    if (!kp || k.toLowerCase().includes(kp.toLowerCase())) items.push(make(k, 'reuse this form schema'));
  }
  if (kp && !keys.some((k) => k.toLowerCase() === kp.toLowerCase())) items.push(make(kp, 'new form schema'));
  if (items.length === 0) {
    items.push({ title: 'name your form', subtitle: 'e.g. /form:travel-stop', icon: FormInput, keywords: [], run: () => {} });
  }
  return items;
}

// Inline tools: type a date in words, do math, or convert a currency, and insert
// the result. The arg is the text after the colon.
function insertText(editor: Editor, range: Range, text: string) {
  editor.chain().focus().deleteRange(range).insertContent(text).run();
}

function dateItems(arg: string): CommandItem[] {
  const parsed = parseHumanDate(arg, Date.now());
  if (!parsed) {
    return [{ title: 'Date', subtitle: 'try /date:next friday, /date:in 3 weeks, /date:25 dec', icon: CalendarDays, keywords: ['date'], run: () => {} }];
  }
  const label = humanDateLabel(parsed);
  return [{ title: label, subtitle: 'insert this date', icon: CalendarDays, keywords: ['date'], run: (editor, range) => insertText(editor, range, label) }];
}

function calcItems(arg: string): CommandItem[] {
  const e = arg.trim();
  if (!e) return [{ title: 'Calculator', subtitle: 'try /calc:2+3*4 or /calc:(1200+800)/2', icon: Calculator, keywords: ['calc', 'math'], run: () => {} }];
  const r = evaluateFormula(e, {});
  if (!r.ok) return [{ title: 'Calculator', subtitle: "that didn't compute, e.g. /calc:2+3*4", icon: Calculator, keywords: ['calc'], run: () => {} }];
  const out = formatFormulaValue(r.value);
  return [{ title: `= ${out}`, subtitle: e, icon: Calculator, keywords: ['calc', 'math'], run: (editor, range) => insertText(editor, range, out) }];
}

function convertItems(arg: string): CommandItem[] {
  const m = /^([\d.,]+)\s*([a-z]{3})\s*(?:to\s*([a-z]{3}))?$/i.exec(arg.trim());
  if (!m) return [{ title: 'Convert currency', subtitle: 'try /convert:30000 jpy or /convert:50 eur to sek', icon: Calculator, keywords: ['convert', 'currency', 'fx'], run: () => {} }];
  const amount = Number(m[1].replace(/,/g, ''));
  const from = m[2].toUpperCase();
  const to = (m[3] || getBaseCurrency()).toUpperCase();
  const result = convert(amount, from, to);
  if (!Number.isFinite(result)) {
    return [{ title: 'Convert currency', subtitle: `no rate for ${from} to ${to} yet`, icon: Calculator, keywords: ['convert'], run: () => {} }];
  }
  const text = `${amount.toLocaleString()} ${from} = ${result.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}`;
  return [{ title: text, subtitle: 'insert the conversion', icon: Calculator, keywords: ['convert', 'currency'], run: (editor, range) => insertText(editor, range, text) }];
}

interface CommandItem {
  title: string;
  subtitle: string;
  icon: typeof Heading1;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
  // 'ttrpg' commands only show when the workspace has tabletop tools turned on.
  group?: 'ttrpg';
}

const COMMANDS: CommandItem[] = [
  {
    title: 'Heading 1',
    subtitle: 'Big section title',
    icon: Heading1,
    keywords: ['h1', 'heading', 'title', 'big'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    subtitle: 'Medium section title',
    icon: Heading2,
    keywords: ['h2', 'heading', 'subtitle'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    subtitle: 'Small section title',
    icon: Heading3,
    keywords: ['h3', 'heading'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Bulleted list',
    subtitle: 'Simple unordered list',
    icon: List,
    keywords: ['bullet', 'list', 'ul', 'unordered'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    subtitle: 'Ordered list',
    icon: ListOrdered,
    keywords: ['number', 'ordered', 'ol', 'list'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'To-do',
    subtitle: 'Checkbox task list',
    icon: CheckSquare,
    keywords: ['todo', 'task', 'checkbox', 'check'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Quote',
    subtitle: 'A plain blockquote',
    icon: Quote,
    keywords: ['quote', 'blockquote'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Callout',
    subtitle: 'Highlighted box with an icon',
    icon: Lightbulb,
    keywords: ['card', 'callout', 'note', 'box', 'highlight', 'info', 'tip', 'warning'],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'calloutCard', attrs: { emoji: '💡', color: 'gray' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    title: 'Columns',
    subtitle: 'Two side-by-side sections, split further inside',
    icon: Columns2,
    keywords: ['columns', 'column', 'split', 'side by side', 'layout', 'divide', 'vertical'],
    run: (editor, range) => insertColumns(editor, range, 2),
  },
  {
    title: 'Three columns',
    subtitle: 'Three side-by-side sections',
    icon: Columns3,
    keywords: ['columns', 'three', '3', 'split', 'layout', 'grid'],
    run: (editor, range) => insertColumns(editor, range, 3),
  },
  {
    title: 'Donut chart',
    subtitle: 'Proportions as a ring',
    icon: PieChart,
    keywords: ['donut', 'doughnut', 'pie', 'chart', 'ring', 'proportion', 'share'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'chartBlock', attrs: { kind: 'donut', title: '', data: sampleChartData() } }).run(),
  },
  {
    title: 'Bar chart',
    subtitle: 'Compare values as vertical bars',
    icon: BarChart3,
    keywords: ['bar', 'chart', 'column', 'graph', 'vertical', 'compare'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'chartBlock', attrs: { kind: 'barv', title: '', data: sampleChartData() } }).run(),
  },
  {
    title: 'Row chart',
    subtitle: 'Compare values as horizontal bars',
    icon: BarChartHorizontal,
    keywords: ['row', 'horizontal', 'bar', 'chart', 'graph'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'chartBlock', attrs: { kind: 'barh', title: '', data: sampleChartData() } }).run(),
  },
  {
    title: 'Number',
    subtitle: 'A single big stat',
    icon: Hash,
    keywords: ['number', 'stat', 'kpi', 'metric', 'count', 'big'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'chartBlock', attrs: { kind: 'number', title: '', data: [{ label: 'Total', value: 0, color: '#b5563a' }] } }).run(),
  },
  {
    title: 'Code block',
    subtitle: 'Monospaced code',
    icon: Code,
    keywords: ['code', 'snippet', 'pre'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Image',
    subtitle: 'Upload or paste a picture',
    icon: ImageIcon,
    keywords: ['image', 'picture', 'photo', 'img', 'upload', 'media'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        // Full-size upload first; fall back to a downscaled inline image.
        void (async () => {
          try {
            const url = await uploadsApi.upload(file);
            const src = url ?? (await processImageFile(file));
            editor.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
          } catch (err) {
            if (err instanceof ImageTooLargeError) toast(err.message, 'error');
            else console.error('[editor] image upload failed', err);
          }
        })();
      };
      input.click();
    },
  },
  {
    title: 'File',
    subtitle: 'Attach a PDF, ticket or doc',
    icon: Paperclip,
    keywords: ['file', 'attachment', 'attach', 'pdf', 'ticket', 'boarding', 'pass', 'doc', 'upload', 'download'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        void processAttachmentFile(file)
          .then((a) => {
            editor.chain().focus().insertContent({ type: 'fileBlock', attrs: a }).run();
          })
          .catch((err) => {
            if (err instanceof FileTooLargeError) toast(err.message, 'error');
            else console.error('[editor] file upload failed', err);
          });
      };
      input.click();
    },
  },
  {
    title: 'Audio',
    subtitle: 'Add a sound file and play it here',
    icon: Music,
    keywords: ['audio', 'sound', 'music', 'song', 'mp3', 'wav', 'track', 'player', 'play', 'recording', 'voice', 'clip'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'audioBlock' }).run();
    },
  },
  {
    title: 'Gallery',
    subtitle: 'A grid of images (a photo dump)',
    icon: Images,
    keywords: ['gallery', 'images', 'photos', 'grid', 'album', 'pictures', 'photo dump', 'masonry', 'wall'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'galleryBlock' }).run();
    },
  },
  {
    title: 'Divider',
    subtitle: 'Horizontal rule',
    icon: Minus,
    keywords: ['divider', 'hr', 'rule', 'separator'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Toggle',
    subtitle: 'A collapsible section: a title that folds its content away',
    icon: ChevronRight,
    keywords: ['toggle', 'collapse', 'collapsible', 'fold', 'details', 'accordion', 'expand'],
    run: (editor, range) => {
      const at = range.from;
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'toggle',
          attrs: { open: true },
          content: [{ type: 'toggleSummary' }, { type: 'toggleContent', content: [{ type: 'paragraph' }] }],
        })
        .run();
      // Land the cursor in the title, not the body: find the summary we just made.
      let summaryPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (summaryPos === -1 && node.type.name === 'toggleSummary' && pos >= at - 2) {
          summaryPos = pos + 1;
          return false;
        }
        return summaryPos === -1;
      });
      if (summaryPos >= 0) editor.commands.setTextSelection(summaryPos);
    },
  },
  {
    title: 'Table of contents',
    subtitle: "A live outline of the page's headings",
    icon: List,
    keywords: ['toc', 'contents', 'outline', 'headings', 'index', 'navigation'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent({ type: 'tableOfContents' }).run(),
  },
  {
    title: 'Math',
    subtitle: 'A TeX equation, rendered',
    icon: Sigma,
    keywords: ['math', 'equation', 'formula', 'tex', 'latex', 'katex'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent({ type: 'mathBlock', attrs: { latex: '' } }).run(),
  },
  {
    title: 'Diagram',
    subtitle: 'A flow or sequence drawn from Mermaid text',
    icon: Workflow,
    keywords: ['diagram', 'mermaid', 'flowchart', 'flow', 'sequence', 'graph', 'chart'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent({ type: 'diagramBlock', attrs: { code: '' } }).run(),
  },
  {
    title: 'Synced page',
    subtitle: "Mirror another page's content here; it updates when the source changes",
    icon: Blocks,
    keywords: ['synced', 'sync', 'mirror', 'transclude', 'reference', 'shared', 'embed page'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent({ type: 'syncedBlock', attrs: { sourceId: '' } }).run(),
  },
  {
    title: 'Date',
    subtitle: "Today, or /date:next friday, in 3 weeks…",
    icon: CalendarDays,
    keywords: ['date', 'today', 'when', 'deadline', 'day'],
    run: (editor, range) => {
      const p = parseHumanDate('today', Date.now());
      insertText(editor, range, p ? humanDateLabel(p) : '');
    },
  },
  {
    title: 'Calculator',
    subtitle: 'Do math in place: /calc:2+3*4',
    icon: Calculator,
    keywords: ['calc', 'calculator', 'math', 'sum', 'compute', 'equals'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).run(),
  },
  {
    title: 'Convert',
    subtitle: 'Currency: /convert:30000 jpy',
    icon: Calculator,
    keywords: ['convert', 'currency', 'fx', 'exchange', 'rate'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).run(),
  },
  {
    title: 'Formula',
    subtitle: 'A live calculation inside the text, recomputed as you edit it',
    icon: Sigma,
    keywords: ['formula', 'fx', 'function', 'calculate', 'live', 'compute', 'equation', 'modifier'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent({ type: 'inlineFormula', attrs: { expr: '' } }).run(),
  },
  {
    title: 'Timer',
    subtitle: 'A countdown you can start in the page',
    icon: Timer,
    keywords: ['timer', 'countdown', 'pomodoro', 'stopwatch', 'minutes', 'clock'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'timerBlock', attrs: { total: 300, remaining: 300, endsAt: 0 } }).run(),
  },
  {
    title: 'Page',
    subtitle: 'Link a page in this workspace, or create one',
    icon: FileText,
    keywords: ['page', 'pages', 'subpage', 'sub-page', 'child', 'doc', 'document', 'nested', 'link', 'mention'],
    run: (editor, range) => {
      // Drop an unlinked page block; its picker lets you link an existing page in
      // this workspace or create a new child page right there.
      editor.chain().focus().deleteRange(range).insertContent({ type: 'pageLink', attrs: { pageId: '', notionId: '', label: '' } }).run();
    },
  },
  {
    title: 'Table',
    subtitle: 'Relational database, grid',
    icon: TableIcon,
    keywords: ['table', 'database', 'grid', 'db'],
    run: (editor, range) => insertPresetTable(editor, range, 'grid'),
  },
  {
    title: 'Linked table',
    subtitle: 'Show another table here, with its own filters',
    icon: TableIcon,
    keywords: ['linked', 'table', 'reference', 'embed', 'view', 'filter', 'database', 'mirror', 'same', 'existing'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'tableEmbed', attrs: { tableId: '', viewConfig: defaultViewConfig() } }).run(),
  },
  {
    title: 'Board',
    subtitle: 'Kanban grouped by status',
    icon: Columns3,
    keywords: ['board', 'kanban', 'status', 'database', 'db'],
    run: (editor, range) => insertPresetTable(editor, range, 'board'),
  },
  {
    title: 'Calendar',
    subtitle: 'Database on a month grid',
    icon: CalendarDays,
    keywords: ['calendar', 'month', 'date', 'schedule', 'database', 'db'],
    run: (editor, range) => insertPresetTable(editor, range, 'calendar'),
  },
  {
    title: 'Timeline',
    subtitle: 'Gantt-style date ranges',
    icon: GanttChartSquare,
    keywords: ['timeline', 'gantt', 'roadmap', 'schedule', 'database', 'db'],
    run: (editor, range) => insertPresetTable(editor, range, 'timeline'),
  },
  {
    title: 'Gallery',
    subtitle: 'Database as cards',
    icon: LayoutGrid,
    keywords: ['gallery', 'cards', 'grid', 'database', 'db'],
    run: (editor, range) => insertPresetTable(editor, range, 'gallery'),
  },
  {
    title: 'Map',
    subtitle: 'Pin entries on a map',
    icon: MapIcon,
    keywords: ['map', 'pins', 'places', 'location', 'geo', 'database', 'db'],
    run: (editor, range) => insertPresetTable(editor, range, 'map'),
  },
  {
    title: 'Accommodation',
    subtitle: 'Hotel / Airbnb tracker',
    icon: BedDouble,
    keywords: ['accommodation', 'hotel', 'airbnb', 'stay', 'lodging', 'booking', 'nights'],
    run: (editor, range) => insertPresetTable(editor, range, 'accommodation'),
  },
  {
    title: 'Journal',
    subtitle: 'Photo travelogue (gallery)',
    icon: NotebookPen,
    keywords: ['journal', 'diary', 'travelogue', 'gallery', 'photos', 'memories', 'log'],
    run: (editor, range) => insertPresetTable(editor, range, 'journal'),
  },
  {
    title: 'Recipe',
    subtitle: 'A recipe card: ingredients to tick and numbered steps',
    icon: ChefHat,
    keywords: ['recipe', 'recipes', 'cook', 'cooking', 'food', 'meal', 'dinner', 'ingredients', 'kitchen'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'recipeCard', attrs: { ingredients: [], steps: [] } }).run(),
  },
  {
    title: 'Case brief',
    subtitle: 'A study card: facts, issue, holding, reasoning',
    icon: Scale,
    keywords: ['case', 'brief', 'law', 'court', 'holding', 'issue', 'ruling', 'judgment', 'irac'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'caseBrief', attrs: {} }).run(),
  },
  {
    title: 'Statute',
    subtitle: 'A citation card: act, section and a plain summary',
    icon: Landmark,
    keywords: ['statute', 'statutes', 'act', 'section', 'legislation', 'law', 'code'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'statute', attrs: {} }).run(),
  },
  {
    title: 'Authorities',
    subtitle: 'Cases, articles and sources to cite',
    icon: Quote,
    keywords: ['authority', 'authorities', 'citation', 'cite', 'source', 'reference', 'bibliography', 'reading'],
    run: (editor, range) => insertPresetTable(editor, range, 'authority'),
  },
  {
    title: 'Lecture notes',
    subtitle: 'Quick notes per topic and date',
    icon: GraduationCap,
    keywords: ['lecture', 'notes', 'class', 'course', 'study', 'seminar', 'topic'],
    run: (editor, range) => insertPresetTable(editor, range, 'lecture'),
  },
  {
    title: 'Bills & subscriptions',
    subtitle: 'Recurring costs with a due reminder',
    icon: Receipt,
    keywords: ['bill', 'bills', 'subscription', 'rent', 'utilities', 'recurring', 'due', 'pay', 'invoice'],
    run: (editor, range) => insertPresetTable(editor, range, 'bills'),
  },
  {
    title: 'Countdown board',
    subtitle: 'Important dates with days left',
    icon: CalendarClock,
    keywords: ['countdown', 'deadline', 'deadlines', 'dates', 'days left', 'visa', 'expiry', 'timer'],
    run: (editor, range) => insertPresetTable(editor, range, 'deadlines'),
  },
  {
    title: 'Meal plan',
    subtitle: 'What to cook this week',
    icon: CookingPot,
    keywords: ['meal', 'meals', 'plan', 'dinner', 'cook', 'week', 'menu', 'food'],
    run: (editor, range) => insertPresetTable(editor, range, 'meals'),
  },
  {
    title: 'Grocery list',
    subtitle: 'Shopping list with aisles',
    icon: ShoppingCart,
    keywords: ['grocery', 'groceries', 'shopping', 'list', 'store', 'buy', 'food'],
    run: (editor, range) => insertPresetTable(editor, range, 'groceries'),
  },
  {
    title: 'Campaign quests',
    subtitle: 'Track quests for a D&D game',
    icon: Swords,
    keywords: ['campaign', 'quest', 'quests', 'dnd', 'd&d', 'ttrpg', 'adventure', 'session'],
    run: (editor, range) => insertPresetTable(editor, range, 'campaign'),
  },
  {
    title: 'Family stuff',
    subtitle: 'A shared list for the family',
    icon: Home,
    keywords: ['family', 'shared', 'home', 'household', 'stuff', 'list', 'wishlist'],
    run: (editor, range) => insertPresetTable(editor, range, 'family'),
  },
  {
    title: 'Itinerary route',
    subtitle: 'Map with day-by-day stops',
    icon: Route,
    keywords: ['itinerary', 'route', 'trip', 'map', 'stops', 'journey', 'plan', 'days'],
    run: (editor, range) => insertPresetTable(editor, range, 'itinerary'),
  },
  {
    title: 'Transport',
    subtitle: 'Flights, trains & buses',
    icon: Plane,
    keywords: ['transport', 'flight', 'train', 'bus', 'ferry', 'travel', 'leg', 'pnr', 'connection'],
    run: (editor, range) => insertPresetTable(editor, range, 'transport'),
  },
  {
    title: 'Day schedule',
    subtitle: 'Hour-by-hour plan for a day',
    icon: CalendarClock,
    keywords: ['schedule', 'agenda', 'hour', 'day', 'time', 'plan', 'timeline'],
    run: (editor, range) => insertPresetTable(editor, range, 'schedule'),
  },
  {
    title: 'Budget',
    subtitle: 'Expenses, split & who owes whom',
    icon: Wallet,
    keywords: ['budget', 'expense', 'expenses', 'money', 'split', 'cost', 'spend', 'settle', 'owe'],
    run: (editor, range) => insertBudget(editor, range),
  },
  {
    title: 'Split budget',
    subtitle: 'Split costs between anyone, no table needed',
    icon: Wallet,
    keywords: ['budget', 'split', 'expense', 'who owes', 'settle', 'bill', 'money', 'share', 'cost', 'widget'],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'budgetWidget', attrs: { title: '', base: getBaseCurrency(), people: [], expenses: [] } })
        .run(),
  },
  {
    title: 'Money dashboard',
    subtitle: 'Totals across your money tables, in both currencies',
    icon: PiggyBank,
    keywords: ['money', 'dashboard', 'total', 'currency', 'fx', 'overview', 'jpy', 'spend', 'monthly'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'moneyDashboard', attrs: { base: getBaseCurrency() } }).run(),
  },
  {
    title: 'Feature tour',
    subtitle: 'A demo page with live tables, money, countdown and more',
    icon: Sparkles,
    keywords: ['demo', 'tour', 'example', 'sample', 'features', 'showcase', 'welcome', 'start'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      void useData.getState().createDemoPage();
    },
  },
  {
    title: 'Packing list',
    subtitle: 'Checklist with priority & % packed',
    icon: Luggage,
    keywords: ['packing', 'pack', 'checklist', 'todo', 'list', 'luggage', 'bag', 'gear'],
    run: (editor, range) => insertPresetTable(editor, range, 'packing'),
  },
  {
    title: 'Routines',
    subtitle: 'Habits with a cadence, streak and days-since',
    icon: Repeat,
    keywords: ['routine', 'habit', 'recurring', 'daily', 'weekly', 'streak', 'ritual'],
    run: (editor, range) => insertPresetTable(editor, range, 'routine'),
  },
  {
    title: 'Reservation',
    subtitle: 'One booking: confirmation # + a countdown',
    icon: CalendarCheck,
    keywords: ['reservation', 'booking', 'flight', 'hotel', 'stay', 'train', 'ticket', 'confirmation', 'reserve', 'single'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'reservationBlock', attrs: { single: true, title: 'Reservation', items: [{ id: Math.random().toString(36).slice(2, 9), kind: 'flight', text: '', code: '', when: '', note: '' }] } }).run();
    },
  },
  {
    title: 'Poll',
    subtitle: 'Vote on a date, place or plan',
    icon: Vote,
    keywords: ['poll', 'vote', 'ballot', 'decide', 'survey', 'choose', 'pick'],
    run: (editor, range) => insertPoll(editor, range),
  },
  {
    title: 'Form',
    subtitle: 'Reusable form (try /form:travel-stop)',
    icon: FormInput,
    keywords: ['form', 'fields', 'survey', 'template', 'entry'],
    run: (editor, range) => insertForm(editor, range, 'form'),
  },
  {
    title: 'Place',
    subtitle: 'Live clock, weather & date',
    icon: Clock,
    keywords: ['place', 'clock', 'time', 'weather', 'city', 'timezone', 'world'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'placeWidget' }).run();
    },
  },
  {
    title: 'Weather',
    subtitle: 'Multi-day forecast for a place',
    icon: CloudSun,
    keywords: ['weather', 'forecast', 'rain', 'temperature', 'climate', 'sun'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'weatherBlock' }).run();
    },
  },
  {
    title: 'Bookmark',
    subtitle: 'Rich link card',
    icon: Link2,
    keywords: ['bookmark', 'link', 'url', 'web', 'embed', 'website'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'bookmarkBlock' }).run();
    },
  },
  {
    title: 'Countdown',
    subtitle: 'Days until a date',
    icon: CalendarClock,
    keywords: ['countdown', 'days', 'until', 'timer', 'date', 'count'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'countdownBlock' }).run();
    },
  },
  {
    title: 'Custom count',
    subtitle: 'A card showing a live value from a grid cell',
    icon: LayoutGrid,
    keywords: ['customcount', 'custom', 'card', 'cell', 'grid', 'value', 'stat', 'metric', 'budget', 'readout', 'kpi'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'customCardBlock' }).run();
    },
  },
  {
    title: 'Vote',
    subtitle: 'Decide together: options with one-tap ❤️ votes',
    icon: Vote,
    keywords: ['vote', 'poll', 'decide', 'choose', 'pick', 'which', 'restaurant', 'options', 'ranking'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'voteBlock' }).run();
    },
  },
  {
    title: 'Tier list',
    subtitle: 'Rank things into S/A/B tiers with images, auto-sorted by score',
    icon: LayoutGrid,
    keywords: ['tier', 'list', 'tierlist', 'rank', 'ranking', 'rating', 'grade', 's tier', 'sort', 'best', 'worst'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'tierListBlock', attrs: { tiers: defaultTiers(), items: [] } }).run();
    },
  },
  {
    title: 'Currency',
    subtitle: 'One amount, every currency you care about, at the latest rate',
    icon: Coins,
    keywords: ['currency', 'rates', 'exchange', 'fx', 'convert', 'money', 'yen', 'jpy', 'sek', 'euro', 'forex'],
    run: (editor, range) => {
      const board = defaultFxBoard(getBaseCurrency());
      editor.chain().focus().deleteRange(range).insertContent({ type: 'currencyBlock', attrs: { amount: board.amount, base: board.base, rows: board.rows } }).run();
    },
  },
  {
    title: 'This or that',
    subtitle: 'A quick two-way call: tap your pick',
    icon: Swords,
    keywords: ['thisorthat', 'this or that', 'versus', 'vs', 'ab', 'a or b', 'either', 'decide', 'pick', 'choice'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'thisOrThatBlock' }).run();
    },
  },
  {
    title: 'Trip readiness',
    subtitle: 'A milestone checklist with a live % gauge',
    icon: Gauge,
    keywords: ['readiness', 'ready', 'gauge', 'progress', 'checklist', 'milestones', 'prep', 'trip', 'status'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'readinessBlock' }).run();
    },
  },
  {
    title: 'Packing tracker',
    subtitle: 'Checklist with a packed bar + per-person filter',
    icon: Luggage,
    keywords: ['packing', 'pack', 'luggage', 'bag', 'tracker', 'checklist', 'suitcase', 'gear', 'widget'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'packingBlock' }).run();
    },
  },
  {
    title: 'Reservations',
    subtitle: 'Flights, stays, tickets with a live countdown',
    icon: Ticket,
    keywords: ['reservation', 'booking', 'flight', 'hotel', 'stay', 'train', 'ticket', 'confirmation', 'itinerary', 'trip'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'reservationBlock', attrs: { items: [{ id: Math.random().toString(36).slice(2, 9), kind: 'flight', text: '', code: '', when: '', note: '' }] } }).run();
    },
  },
  {
    title: 'Compare',
    subtitle: 'Side-by-side decision table, star the pick',
    icon: Scale,
    keywords: ['compare', 'comparison', 'decision', 'versus', 'vs', 'pros', 'cons', 'matrix', 'options', 'choose'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'compareBlock' }).run();
    },
  },
  {
    title: 'Setlist',
    subtitle: 'Running order: songs, banter, segments',
    icon: Music2,
    keywords: ['setlist', 'set', 'songs', 'gig', 'concert', 'band', 'running order', 'show', 'music'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'setlistBlock' }).run();
    },
  },
  {
    title: 'Quiz',
    subtitle: 'Questions with hidden answers to run live',
    icon: HelpCircle,
    keywords: ['quiz', 'questions', 'trivia', 'game', 'intro quiz', 'q and a', 'pub quiz'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'quizBlock' }).run();
    },
  },
  {
    title: 'Embed',
    subtitle: 'YouTube, Maps, Docs, Spotify…',
    icon: Tv,
    keywords: ['embed', 'iframe', 'youtube', 'video', 'maps', 'spotify', 'docs', 'google'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'embedBlock' }).run();
    },
  },
  {
    title: 'Character sheet',
    subtitle: 'Fill a form, get a character page',
    icon: UserRound,
    keywords: ['character', 'sheet', 'pc', 'hero', 'player', 'gamer', 'stats', 'dnd', 'ttrpg'],
    group: 'ttrpg',
    run: (editor, range) => {
      // Clear the slash text, then open the form at the app root, the new page
      // it creates becomes the active page, so there's nothing to insert here.
      editor.chain().focus().deleteRange(range).run();
      openCharacterForm();
    },
  },
  {
    title: 'Roll dice',
    subtitle: 'd20 now · /roll:2d6+3 for a custom roll',
    icon: Dices,
    keywords: ['roll', 'dice', 'd20', 'd6', 'random', 'dnd', 'ttrpg'],
    group: 'ttrpg',
    run: (editor, range) => {
      const inserted = formatRoll('1d20', rollDiceDetailed('1d20', Math.random));
      editor.chain().focus().deleteRange(range).insertContent(inserted).run();
    },
  },
  {
    title: 'Roll table',
    subtitle: 'Weighted table (encounters, loot, rumors)',
    icon: Dice5,
    keywords: ['rolltable', 'roll', 'table', 'encounter', 'loot', 'rumor', 'random', 'dnd', 'ttrpg'],
    group: 'ttrpg',
    run: (editor, range) => insertPresetTable(editor, range, 'rolltable'),
  },
  {
    title: 'Initiative tracker',
    subtitle: 'Combat order, HP & conditions',
    icon: Swords,
    keywords: ['initiative', 'combat', 'encounter', 'fight', 'init', 'hp', 'dnd', 'ttrpg'],
    group: 'ttrpg',
    run: (editor, range) => insertPresetTable(editor, range, 'combat'),
  },
  {
    title: 'Campaign bible',
    subtitle: 'NPCs, locations, factions, quests & more',
    icon: ScrollText,
    keywords: ['campaign', 'bible', 'npc', 'faction', 'quest', 'session', 'location', 'item', 'dnd', 'ttrpg'],
    group: 'ttrpg',
    run: (editor, range) => insertCampaign(editor, range),
  },
  {
    title: 'Flow',
    subtitle: 'Open the automation canvas',
    icon: Zap,
    keywords: ['flow', 'flows', 'automation', 'automate', 'trigger', 'when', 'rule'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      const { activePageId, requestPageTab } = useData.getState();
      if (activePageId) requestPageTab(activePageId, 'flow');
    },
  },
];

interface MenuRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const CommandMenu = forwardRef(function CommandMenu(
  props: SuggestionProps<CommandItem>,
  ref: ForwardedRef<MenuRef>,
) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [props.items]);

  const pick = (index: number) => {
    const item = props.items[index];
    if (item) props.command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % props.items.length);
        return true;
      }
      if (event.key === 'Enter') {
        pick(selected);
        return true;
      }
      return false;
    },
  }));

  if (props.items.length === 0) {
    return (
      <div className="w-72 rounded-lg border border-paper-line bg-paper p-3 text-sm text-ink-faint shadow-xl dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft">
        No matching blocks
      </div>
    );
  }

  return (
    <div className="max-h-80 w-72 overflow-y-auto rounded-lg border border-paper-line bg-paper p-1.5 shadow-xl dark:border-coal-line dark:bg-coal-panel">
      {props.items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={item.title}
            type="button"
            onMouseEnter={() => setSelected(i)}
            onClick={() => pick(i)}
            className={[
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
              i === selected ? 'bg-paper-panel dark:bg-coal-line' : '',
            ].join(' ')}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-paper-line bg-paper text-ink-soft dark:border-coal-line dark:bg-coal dark:text-coal-soft">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink dark:text-coal-text">{item.title}</span>
              <span className="block truncate text-xs text-ink-faint dark:text-coal-soft">{item.subtitle}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
});

function makeRenderer() {
  let component: ReactRenderer<MenuRef, SuggestionProps<CommandItem>> | null = null;
  let popup: HTMLDivElement | null = null;

  const place = (clientRect: (() => DOMRect | null) | null | undefined) => {
    if (!popup || !clientRect) return;
    const rect = clientRect();
    if (!rect) return;
    const margin = 8;
    const menuWidth = 288;
    let left = rect.left;
    let top = rect.bottom + margin;
    if (left + menuWidth > window.innerWidth - margin) left = window.innerWidth - menuWidth - margin;
    if (top + 320 > window.innerHeight && rect.top - margin - 320 > 0) {
      top = rect.top - margin;
      popup.style.transform = 'translateY(-100%)';
    } else {
      popup.style.transform = 'none';
    }
    popup.style.left = `${Math.max(margin, left)}px`;
    popup.style.top = `${top}px`;
  };

  return {
    onStart: (props: SuggestionProps<CommandItem>) => {
      component = new ReactRenderer(CommandMenu, { props, editor: props.editor });
      popup = document.createElement('div');
      popup.style.position = 'fixed';
      // Above the row drawer (z-[1200]) and the upload modal, not just above the
      // page. At z-50 the menu portalled to <body> rendered BEHIND any drawer, so
      // opening "/" inside a calendar item or a kanban card looked like a short
      // or missing command list rather than a hidden one.
      popup.style.zIndex = '1300';
      popup.appendChild(component.element);
      document.body.appendChild(popup);
      place(props.clientRect);
    },
    onUpdate: (props: SuggestionProps<CommandItem>) => {
      component?.updateProps(props);
      place(props.clientRect);
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') return true;
      return component?.ref?.onKeyDown(props) ?? false;
    },
    onExit: () => {
      popup?.remove();
      popup = null;
      component?.destroy();
      component = null;
    },
  };
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        // Allow spaces so colon args can be natural phrases (/date:next friday,
        // /convert:30000 jpy to sek). A space with no matching command shows the
        // empty state, which closes on escape or backspace.
        allowSpaces: true,
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: CommandItem }) => {
          props.run(editor, range);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<CommandItem>({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase().trim();
          // Tabletop commands are hidden unless an admin turned the tools on for
          // this workspace (Members panel). Everything else is always available.
          const tabletop = useWorkspace.getState().tabletopEnabled();
          const allowed = (c: CommandItem) => tabletop || c.group !== 'ttrpg';
          // /form:<key> is dynamic, find-or-create a form for that key and
          // suggest keys already in use. The static commands stay untouched.
          if (q.startsWith('form:')) return formItems(query.trim().slice(5));
          // /roll:<expr> rolls a custom dice expression with a live preview.
          if (q.startsWith('roll:')) return tabletop ? rollItems(query.trim().slice(5)) : [];
          // Inline tools: a date in words, math, a currency conversion.
          if (q.startsWith('date:')) return dateItems(query.trim().slice(5));
          if (q.startsWith('calc:')) return calcItems(query.trim().slice(5));
          if (q.startsWith('convert:')) return convertItems(query.trim().slice(8));
          if (!q) return COMMANDS.filter(allowed);
          return COMMANDS.filter(allowed).filter(
            (c) => c.title.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q)),
          );
        },
        render: makeRenderer,
      }),
    ];
  },
});
