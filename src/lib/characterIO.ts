// ---------------------------------------------------------------------------
// characterIO, JSON <-> character sheet for import / export (like the recipe
// widget). A sheet round-trips through a file or the clipboard, and a blank
// template / worked example can be filled in offline. Forgiving about key names
// (class/className, str/strength, hp/maxHp, ...) and dependency-free, so it is
// testable. Import takes the FIRST sheet if handed an array. Pure: no React.
// ---------------------------------------------------------------------------

import { emptyCharacter, ABILITIES, type AbilityKey, type CharacterSheet } from './character';

function num(v: unknown, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const s = String(v ?? '').trim();
  if (s === '') return fallback; // undefined/empty must fall back, not coerce to 0
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
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

// Long names accepted for each ability alongside the short key.
const ABILITY_ALIASES: Record<AbilityKey, string[]> = {
  str: ['str', 'strength'],
  dex: ['dex', 'dexterity'],
  con: ['con', 'constitution'],
  int: ['int', 'intelligence'],
  wis: ['wis', 'wisdom'],
  cha: ['cha', 'charisma'],
};

/** Serialize a sheet to pretty JSON for download / clipboard. */
export function sheetToJSON(sheet: CharacterSheet): string {
  return JSON.stringify(sheet, null, 2);
}

/** Parse pasted/loaded JSON into a normalised CharacterSheet. Accepts a single
 *  object or an array (first wins), and reads abilities either nested under
 *  "abilities" or spread as top-level str/dex/... keys. Throws only on non-JSON. */
export function parseCharacter(text: string): CharacterSheet {
  const t = text.trim();
  if (!t) return emptyCharacter();
  const raw = JSON.parse(t) as unknown;
  const first = Array.isArray(raw) ? raw.find((x) => x && typeof x === 'object') : raw;
  const o = (first && typeof first === 'object' ? first : {}) as Record<string, unknown>;

  const base = emptyCharacter();
  const abilitiesSrc = (pick(o, ['abilities', 'stats', 'scores']) ?? o) as Record<string, unknown>;
  const abilities = { ...base.abilities };
  for (const { key } of ABILITIES) {
    const v = pick(abilitiesSrc, ABILITY_ALIASES[key]);
    abilities[key] = Math.round(num(v, base.abilities[key]));
  }

  return {
    name: str(pick(o, ['name', 'character', 'charactername', 'character name'])) || base.name,
    player: str(pick(o, ['player', 'playername', 'player name', 'user'])) || base.player,
    race: str(pick(o, ['race', 'species', 'ancestry', 'lineage'])) || base.race,
    className: str(pick(o, ['classname', 'class', 'job'])) || base.className,
    level: Math.max(1, Math.round(num(pick(o, ['level', 'lvl']), base.level))),
    background: str(pick(o, ['background', 'origin'])) || base.background,
    alignment: str(pick(o, ['alignment', 'align'])) || base.alignment,
    abilities,
    maxHp: Math.round(num(pick(o, ['maxhp', 'hp', 'hitpoints', 'hit points', 'health']), base.maxHp)),
    ac: Math.round(num(pick(o, ['ac', 'armorclass', 'armor class', 'armour class']), base.ac)),
    speed: Math.round(num(pick(o, ['speed', 'movement', 'move']), base.speed)),
    notes: str(pick(o, ['notes', 'note', 'bio', 'description', 'backstory'])) || base.notes,
  };
}

// A blank fill-in template: a scaffold with placeholder-ish defaults that imports
// cleanly (an all-empty sheet would still import, but this shows every field).
export const CHARACTER_TEMPLATE: CharacterSheet = {
  name: 'Character name',
  player: 'Your name',
  race: 'Race',
  className: 'Class',
  level: 1,
  background: 'Background',
  alignment: 'Alignment',
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  maxHp: 10,
  ac: 10,
  speed: 30,
  notes: 'Anything worth remembering at the table.',
};

// A worked example that imports as-is, to copy the shape from.
export const CHARACTER_EXAMPLE: CharacterSheet = {
  name: 'Mirelle Duskwood',
  player: 'Sam',
  race: 'Wood Elf',
  className: 'Ranger',
  level: 3,
  background: 'Outlander',
  alignment: 'Chaotic Good',
  abilities: { str: 12, dex: 17, con: 13, int: 10, wis: 15, cha: 8 },
  maxHp: 27,
  ac: 15,
  speed: 35,
  notes: 'Hunts the northern passes. Owns a bad-tempered owl named Pers.',
};

export const CHARACTER_TEMPLATE_JSON = sheetToJSON(CHARACTER_TEMPLATE);
export const CHARACTER_EXAMPLE_JSON = sheetToJSON(CHARACTER_EXAMPLE);
