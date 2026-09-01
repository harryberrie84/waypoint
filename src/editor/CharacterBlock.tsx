import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Heart, Shield, Footprints, Pencil, Download, Upload, FileDown, Copy } from 'lucide-react';
import { CharacterFields } from '../components/CharacterFields';
import {
  ABILITIES, abilityMod, formatMod, proficiencyBonus, characterTagline, emptyCharacter,
} from '../lib/character';
import type { CharacterSheet } from '../lib/character';
import { sheetToJSON, parseCharacter, CHARACTER_TEMPLATE_JSON } from '../lib/characterIO';
import { toast } from '../store/useToast';

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// characterSheet, a 5e-flavoured stat block living in a page's content. The
// whole sheet rides in `data`; the /character form seeds it, and the pencil
// reopens the same fields inline so display and editing never drift.

function CharacterView({ node, updateAttributes, editor }: NodeViewProps) {
  const data = (node.attrs.data as CharacterSheet | null) ?? emptyCharacter();
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');

  const safe = (data.name || 'character').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'character';
  const doExport = () => downloadText(`${safe}.json`, sheetToJSON(data));
  const doCopy = () => {
    void navigator.clipboard?.writeText(sheetToJSON(data)).then(() => toast('Character copied as JSON'));
  };
  const doImport = () => {
    let sheet: CharacterSheet;
    try {
      sheet = parseCharacter(importText);
    } catch {
      toast('That is not valid JSON', 'error');
      return;
    }
    updateAttributes({ data: sheet });
    setImporting(false);
    setImportText('');
    toast(`Imported ${sheet.name || 'character'}`);
  };

  if (editing && editable) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <div className="rounded-xl border border-paper-line bg-paper-panel/50 p-3 dark:border-coal-line dark:bg-coal/40">
          <CharacterFields value={data} onChange={(next) => updateAttributes({ data: next })} />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay-soft"
            >
              Done
            </button>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  const tagline = characterTagline(data);

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="relative overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/70 to-paper-panel/40 p-4 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-7">
          <span className="font-display text-lg font-semibold text-ink dark:text-coal-text">{data.name || 'Unnamed'}</span>
          {tagline && <span className="text-sm text-ink-soft dark:text-coal-soft">{tagline}</span>}
          {data.player && <span className="text-xs text-ink-faint dark:text-coal-soft">· {data.player}</span>}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Stat icon={Heart} label="HP" value={data.maxHp} />
          <Stat icon={Shield} label="AC" value={data.ac} />
          <Stat icon={Footprints} label="Speed" value={`${data.speed} ft`} />
          <span className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper/60 px-2.5 py-1 dark:border-coal-line dark:bg-coal-panel/60">
            <span className="text-xs text-ink-faint dark:text-coal-soft">Prof</span>
            <span className="font-semibold tabular-nums text-ink dark:text-coal-text">{formatMod(proficiencyBonus(data.level))}</span>
          </span>
        </div>

        <div className="mt-3 grid grid-cols-6 gap-1.5">
          {ABILITIES.map(({ key, label }) => (
            <div key={key} className="rounded-lg border border-paper-line bg-paper/60 py-1.5 text-center dark:border-coal-line dark:bg-coal-panel/60">
              <div className="text-[10px] font-semibold text-ink-faint dark:text-coal-soft">{label}</div>
              <div className="text-base font-semibold text-ink dark:text-coal-text">{data.abilities[key]}</div>
              <div className="text-[11px] tabular-nums text-clay">{formatMod(abilityMod(data.abilities[key]))}</div>
            </div>
          ))}
        </div>

        {(data.background || data.alignment) && (
          <div className="mt-3 flex flex-wrap gap-x-4 text-xs text-ink-faint dark:text-coal-soft">
            {data.background && <span>Background: {data.background}</span>}
            {data.alignment && <span>Alignment: {data.alignment}</span>}
          </div>
        )}

        {data.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft dark:text-coal-soft">{data.notes}</p>}

        {editable && (
          <div className="absolute right-2 top-2 flex items-center gap-0.5">
            <button type="button" onClick={doExport} className={iconBtn} title="Export as JSON">
              <Download className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={doCopy} className={iconBtn} title="Copy as JSON">
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => downloadText('character-template.json', CHARACTER_TEMPLATE_JSON)} className={iconBtn} title="Download a fill-in template">
              <FileDown className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setImporting((v) => !v)} className={iconBtn} title="Import from JSON">
              <Upload className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setEditing(true)} className={iconBtn} title="Edit character">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {editable && importing && (
          <div className="mt-3 space-y-2 rounded-lg border border-paper-line bg-paper/70 p-2 dark:border-coal-line dark:bg-coal/40">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={5}
              placeholder={'Paste a character sheet as JSON:\n\n{ "name": "…", "class": "Ranger", "level": 3,\n  "abilities": { "str": 12, "dex": 17, … }, "maxHp": 27, "ac": 15 }'}
              className="w-full resize-none rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
            />
            <div className="flex items-center gap-2">
              <button type="button" onClick={doImport} className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay-soft">
                Load
              </button>
              <button type="button" onClick={() => setImporting(false)} className="text-sm text-ink-faint hover:text-ink dark:text-coal-soft">
                Cancel
              </button>
              <span className="ml-auto text-[10px] text-ink-faint dark:text-coal-soft">replaces this sheet</span>
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

const iconBtn = 'rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line';

function Stat({ icon: Icon, label, value }: { icon: typeof Heart; label: string; value: string | number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper/60 px-2.5 py-1 dark:border-coal-line dark:bg-coal-panel/60">
      <Icon className="h-3.5 w-3.5 text-clay" />
      <span className="text-xs text-ink-faint dark:text-coal-soft">{label}</span>
      <span className="font-semibold tabular-nums text-ink dark:text-coal-text">{value}</span>
    </span>
  );
}

export const CharacterBlock = Node.create({
  name: 'characterSheet',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      // The whole sheet as a JSON object. Default null so an attr-less node still
      // renders (falls back to a blank sheet in the view).
      data: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-character');
          if (!raw) return null;
          try {
            return JSON.parse(raw) as CharacterSheet;
          } catch {
            return null;
          }
        },
        renderHTML: (attrs) => (attrs.data ? { 'data-character': JSON.stringify(attrs.data) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-character-sheet]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-character-sheet': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CharacterView);
  },
});
