// ---------------------------------------------------------------------------
// Dice, the one source of randomness in the app, kept pure by injection.
// ---------------------------------------------------------------------------
// The formula engine is deterministic and re-runs on every render for formula
// *columns*. Randomness can't live in that path or a column would reshuffle on
// every keystroke. So the rng is an injected capability (like fx): callers that
// genuinely want a roll, a /roll command, a flow action, a roll button, pass
// a real Math.random; the formula-column path passes nothing and dice/rand/pick
// throw instead of lying. This module is the parser/roller behind those calls,
// with no React or store imports so it tests directly.

export type Rng = () => number; // [0,1), injected so the engine stays pure

export interface DiceRoll {
  dice: number[]; // every die rolled, in roll order
  kept: number[]; // the subset summed (all of `dice` unless kh/kl trimmed it)
  modifier: number; // the flat +/- after the dice
  total: number; // sum(kept) + modifier
}

// NdM with an optional keep-highest/lowest and a flat modifier:
//   2d6   1d20   2d6+3   4d6kh3   2d20kl1-1
// N defaults to 1 ("d20" === "1d20"). Whitespace is tolerated.
const DICE_RE = /^\s*(\d*)\s*d\s*(\d+)\s*(?:(kh|kl)\s*(\d+))?\s*([+-]\s*\d+)?\s*$/i;

/** Roll a dice spec, returning the full breakdown. Throws on a malformed spec
 *  so callers surface an error rather than a silent 0. */
export function rollDiceDetailed(spec: string, rng: Rng): DiceRoll {
  const m = DICE_RE.exec(spec);
  if (!m) throw new Error(`bad dice "${spec}"`);
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  const keepKind = m[3]?.toLowerCase() as 'kh' | 'kl' | undefined;
  const keepN = m[4] ? Number(m[4]) : undefined;
  const modifier = m[5] ? Number(m[5].replace(/\s+/g, '')) : 0;
  if (count < 1 || count > 1000) throw new Error('dice count out of range');
  if (sides < 1 || sides > 1000) throw new Error('dice sides out of range');

  const dice: number[] = [];
  for (let i = 0; i < count; i++) dice.push(1 + Math.floor(rng() * sides));

  let kept = dice;
  if (keepKind && keepN !== undefined) {
    const sorted = [...dice].sort((a, b) => (keepKind === 'kh' ? b - a : a - b));
    kept = sorted.slice(0, Math.max(0, Math.min(keepN, dice.length)));
  }

  const total = kept.reduce((s, n) => s + n, 0) + modifier;
  return { dice, kept, modifier, total };
}

/** Roll a dice spec and return just the total, the formula-engine entry point. */
export function rollDice(spec: string, rng: Rng): number {
  return rollDiceDetailed(spec, rng).total;
}

/** "2d6+3 → [4,5]+3 = 12", the human-readable readout for /roll. */
export function formatRoll(spec: string, roll: DiceRoll): string {
  const trimmed = spec.trim();
  const dicePart = `[${roll.dice.join(',')}]`;
  const keptNote = roll.kept.length !== roll.dice.length ? ` keep ${roll.kept.join(',')}` : '';
  const modPart = roll.modifier ? (roll.modifier > 0 ? `+${roll.modifier}` : `${roll.modifier}`) : '';
  return `${trimmed} → ${dicePart}${keptNote}${modPart} = ${roll.total}`;
}

// --- Roll tables ------------------------------------------------------------

/** Weighted pick over rows: cumulative weights, one rng draw. A row with no
 *  weight counts as 1 so a plain list still rolls uniformly. Empty → null. */
export function rollOnTable<T>(rows: { weight?: number; value: T }[], rng: Rng): T | null {
  if (rows.length === 0) return null;
  const weights = rows.map((r) => (typeof r.weight === 'number' && r.weight > 0 ? r.weight : 1));
  const total = weights.reduce((s, w) => s + w, 0);
  let draw = rng() * total;
  for (let i = 0; i < rows.length; i++) {
    draw -= weights[i];
    if (draw < 0) return rows[i].value;
  }
  return rows[rows.length - 1].value; // rng()===0.999.. rounding guard
}
