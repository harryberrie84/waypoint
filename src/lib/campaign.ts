import type { Column, SelectOption } from '../types';
import { uid, pickTagColor } from './id';

// ---------------------------------------------------------------------------
// Campaign bible, the relational core of the TTRPG layer: PCs, NPCs, Locations,
// Factions, Sessions, Quests, Items, wired together with relations. Relations
// need a target *table id*, which doesn't exist until the tables are created, so
// the bundle is built in two passes: this module produces the column specs (with
// relation columns left un-pointed and a `links` note saying which sibling each
// points at), the store creates the tables, then `relationPatchesFor` turns the
// real ids into column patches. Everything here is pure so the wiring is tested
// directly, no store, no PocketBase.
//
// Reuse, not invent: each table is an ordinary table (title column first), so the
// mindmap can graph the NPC/Faction relations as a who-knows-who web, the flow
// canvas can model a quest tree, `progress` is the quest clock, and the new
// backlinks panel covers "which sessions reference this NPC" (a faction's member
// count is a backlink, not a rollup, rollup only follows forward relations).

export type CampaignKey = 'pcs' | 'npcs' | 'locations' | 'factions' | 'sessions' | 'quests' | 'items';

export interface CampaignLink {
  columnId: string; // the relation column on this table…
  toKey: CampaignKey; // …points at this sibling table (or itself for self-relations)
}

export interface CampaignTableSpec {
  key: CampaignKey;
  name: string;
  columns: Column[];
  links: CampaignLink[];
}

function sel(name: string, labels: string[], width = 130): Column {
  const options: SelectOption[] = labels.map((label, i) => ({ id: uid('o'), label, color: pickTagColor(i) }));
  return { id: uid('c'), name, type: 'select', width, options };
}

/** Build the seven table specs with fresh ids. Relation columns are created
 *  without a target; `links` records the intended sibling for each. */
export function buildCampaignBundle(): CampaignTableSpec[] {
  const specs: CampaignTableSpec[] = [];
  const add = (key: CampaignKey, name: string, build: (link: (toKey: CampaignKey) => Column) => Column[]) => {
    const links: CampaignLink[] = [];
    const link = (toKey: CampaignKey): Column => {
      const c: Column = { id: uid('c'), name: '', type: 'relation', width: 160 };
      links.push({ columnId: c.id, toKey });
      return c;
    };
    const columns = build(link);
    specs.push({ key, name, columns, links });
  };

  add('npcs', 'NPCs', (link) => [
    { id: uid('c'), name: 'Name', type: 'text', width: 180 },
    sel('Role', ['Ally', 'Rival', 'Patron', 'Merchant', 'Foe']),
    { ...link('locations'), name: 'Location' },
    { ...link('factions'), name: 'Faction' },
    sel('Status', ['Alive', 'Dead', 'Unknown']),
    { id: uid('c'), name: 'Notes', type: 'text', width: 240 },
    { id: uid('c'), name: 'Portrait', type: 'attachment', width: 120 },
  ]);

  add('locations', 'Locations', (link) => [
    { id: uid('c'), name: 'Name', type: 'text', width: 180 },
    sel('Region', ['City', 'Wilds', 'Dungeon', 'Plane']),
    { id: uid('c'), name: 'Place', type: 'place', width: 180 },
    { ...link('locations'), name: 'Parent' },
    { id: uid('c'), name: 'Notes', type: 'text', width: 240 },
  ]);

  add('factions', 'Factions', () => [
    { id: uid('c'), name: 'Name', type: 'text', width: 180 },
    { id: uid('c'), name: 'Goal', type: 'text', width: 240 },
    { id: uid('c'), name: 'Reputation', type: 'number', width: 110 },
    { id: uid('c'), name: 'Notes', type: 'text', width: 240 },
  ]);

  add('sessions', 'Sessions', (link) => [
    { id: uid('c'), name: 'Title', type: 'text', width: 200 },
    { id: uid('c'), name: 'Number', type: 'number', width: 90 },
    { id: uid('c'), name: 'Date', type: 'date', width: 130 },
    { id: uid('c'), name: 'Recap', type: 'text', width: 280 },
    { ...link('npcs'), name: 'NPCs' },
    { ...link('locations'), name: 'Locations' },
    { id: uid('c'), name: 'XP', type: 'number', width: 90 },
  ]);

  add('quests', 'Quests', (link) => [
    { id: uid('c'), name: 'Name', type: 'text', width: 200 },
    { ...link('npcs'), name: 'Giver' },
    sel('Status', ['Rumor', 'Active', 'Done']),
    { id: uid('c'), name: 'Clock', type: 'progress', width: 140 }, // Blades-style segment clock
    { id: uid('c'), name: 'Reward', type: 'text', width: 200 },
    { ...link('quests'), name: 'Related' },
  ]);

  add('items', 'Items', (link) => [
    { id: uid('c'), name: 'Name', type: 'text', width: 180 },
    sel('Rarity', ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary']),
    { ...link('npcs'), name: 'Owner' },
    { id: uid('c'), name: 'Attunement', type: 'checkbox', width: 110 },
    { id: uid('c'), name: 'Notes', type: 'text', width: 240 },
  ]);

  add('pcs', 'PCs', (link) => [
    { id: uid('c'), name: 'Name', type: 'text', width: 180 },
    { id: uid('c'), name: 'Player', type: 'person', width: 150 },
    sel('Class', ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'], 140),
    { id: uid('c'), name: 'Level', type: 'number', width: 80 },
    { id: uid('c'), name: 'AC', type: 'number', width: 70 },
    { id: uid('c'), name: 'HP', type: 'number', width: 80 },
    { ...link('items'), name: 'Inventory' },
  ]);

  return specs;
}

/** Once the tables exist, turn each spec's links into column patches that point
 *  the relation columns at their real sibling table ids. */
export function relationPatchesFor(
  specs: CampaignTableSpec[],
  idByKey: Record<CampaignKey, string>,
): { tableId: string; columnId: string; relationTableId: string }[] {
  const patches: { tableId: string; columnId: string; relationTableId: string }[] = [];
  for (const spec of specs) {
    const tableId = idByKey[spec.key];
    if (!tableId) continue;
    for (const l of spec.links) {
      const relationTableId = idByKey[l.toKey];
      if (relationTableId) patches.push({ tableId, columnId: l.columnId, relationTableId });
    }
  }
  return patches;
}
