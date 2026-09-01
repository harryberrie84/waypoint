// Character sheets, the pure model behind the /character form and the
// characterSheet block. A sheet is plain data that lives inside a page's content
// JSON (the block's attrs), so there's no schema field and nothing to degrade.
// 5e is the reference, but nothing here enforces rules, the numbers are yours.

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITIES: { key: AbilityKey; label: string }[] = [
  { key: 'str', label: 'STR' },
  { key: 'dex', label: 'DEX' },
  { key: 'con', label: 'CON' },
  { key: 'int', label: 'INT' },
  { key: 'wis', label: 'WIS' },
  { key: 'cha', label: 'CHA' },
];

export type AbilityScores = Record<AbilityKey, number>;

export interface CharacterSheet {
  name: string;
  player: string; // who runs them at the table (free text, no user relation)
  race: string;
  className: string; // `class` is a reserved word; keep the data key honest
  level: number;
  background: string;
  alignment: string;
  abilities: AbilityScores;
  maxHp: number;
  ac: number;
  speed: number;
  notes: string;
}

// 5e ability modifier: floor((score - 10) / 2). Math.floor handles the negative
// side correctly (a 7 → -2), which truncation toward zero would get wrong.
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

// Proficiency bonus by level: +2 at 1–4, then +1 every four levels.
export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

// Modifiers read with their sign, the way a sheet prints them ("+3", "-1", "+0").
export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export const CLASSES = [
  'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk',
  'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard', 'Artificer',
];

const CLASS_ICONS: Record<string, string> = {
  barbarian: '🪓', bard: '🎵', cleric: '✨', druid: '🍃', fighter: '⚔️',
  monk: '👊', paladin: '🛡️', ranger: '🏹', rogue: '🗡️', sorcerer: '🔮',
  warlock: '👁️', wizard: '🧙', artificer: '⚙️',
};

// A page icon for the sheet, picked from the class. Falls back to a die so a
// blank or homebrew class still gets something recognisable.
export function classIcon(className: string): string {
  return CLASS_ICONS[className.trim().toLowerCase()] ?? '🎲';
}

export function emptyCharacter(): CharacterSheet {
  return {
    name: '',
    player: '',
    race: '',
    className: '',
    level: 1,
    background: '',
    alignment: '',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    maxHp: 10,
    ac: 10,
    speed: 30,
    notes: '',
  };
}

// One-liner under the name on the block and the page: "Level 3 Wood Elf Ranger".
export function characterTagline(c: CharacterSheet): string {
  const cls = [c.race, c.className].filter(Boolean).join(' ');
  const lvl = c.level ? `Level ${c.level}` : '';
  return [lvl, cls].filter(Boolean).join(' ').trim();
}

// The page body for a new sheet: the block holding the data, then an empty line
// to write into. The block's attrs are the source of truth; nothing is copied.
export function characterDoc(c: CharacterSheet): object {
  return {
    type: 'doc',
    content: [
      { type: 'characterSheet', attrs: { data: c } },
      { type: 'paragraph' },
    ],
  };
}
