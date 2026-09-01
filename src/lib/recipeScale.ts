// Scale and convert recipe ingredient lines. Swedish measures are primary (krm,
// tsk, msk, dl, l, g, kg); a line can also be shown in US units. After scaling we
// re-pick the unit so the amount reads nicely (45 ml -> 3 msk, 1500 ml -> 1,5 l,
// 1200 g -> 1,2 kg). Pure and dependency-free, so it's testable.

export type UnitSystem = 'sv' | 'us';

// Known units mapped to a canonical base (ml for volume, g for mass). Aliases let
// real-world input ("matsked", "tablespoon", "gram") resolve.
const UNITS: Record<string, { dim: 'vol' | 'mass'; base: number }> = {
  // Swedish + metric volume
  krm: { dim: 'vol', base: 1 },
  tsk: { dim: 'vol', base: 5 },
  msk: { dim: 'vol', base: 15 },
  dl: { dim: 'vol', base: 100 },
  l: { dim: 'vol', base: 1000 },
  ml: { dim: 'vol', base: 1 },
  cl: { dim: 'vol', base: 10 },
  liter: { dim: 'vol', base: 1000 },
  // US volume
  tsp: { dim: 'vol', base: 4.92892 },
  teaspoon: { dim: 'vol', base: 4.92892 },
  tbsp: { dim: 'vol', base: 14.7868 },
  tablespoon: { dim: 'vol', base: 14.7868 },
  cup: { dim: 'vol', base: 236.588 },
  cups: { dim: 'vol', base: 236.588 },
  'fl oz': { dim: 'vol', base: 29.5735 },
  pint: { dim: 'vol', base: 473.176 },
  quart: { dim: 'vol', base: 946.353 },
  // mass
  g: { dim: 'mass', base: 1 },
  gram: { dim: 'mass', base: 1 },
  hg: { dim: 'mass', base: 100 },
  kg: { dim: 'mass', base: 1000 },
  mg: { dim: 'mass', base: 0.001 },
  oz: { dim: 'mass', base: 28.3495 },
  ounce: { dim: 'mass', base: 28.3495 },
  lb: { dim: 'mass', base: 453.592 },
  lbs: { dim: 'mass', base: 453.592 },
  pound: { dim: 'mass', base: 453.592 },
};

// Output ladders, largest first. We pick the largest unit the amount fills.
const LADDERS: Record<UnitSystem, { vol: [string, number][]; mass: [string, number][] }> = {
  sv: {
    vol: [['l', 1000], ['dl', 100], ['msk', 15], ['tsk', 5], ['krm', 1]],
    mass: [['kg', 1000], ['g', 1]],
  },
  us: {
    vol: [['cup', 236.588], ['tbsp', 14.7868], ['tsp', 4.92892]],
    mass: [['lb', 453.592], ['oz', 28.3495]],
  },
};

const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

/** Parse a quantity token: "1,5", "1.5", "1/2", "½", "1 ½". Null if not numeric. */
export function parseQty(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  let total = 0;
  let matched = false;
  for (const part of s.split(/\s+/)) {
    if (part in FRACTIONS) {
      total += FRACTIONS[part];
      matched = true;
    } else if (/^\d+\/\d+$/.test(part)) {
      const [a, b] = part.split('/').map(Number);
      if (b) {
        total += a / b;
        matched = true;
      }
    } else {
      const n = Number(part.replace(',', '.'));
      if (Number.isFinite(n)) {
        total += n;
        matched = true;
      } else {
        return matched ? total : null;
      }
    }
  }
  return matched ? total : null;
}

function formatNum(n: number, system: UnitSystem): string {
  const rounded = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  let s = String(rounded);
  if (system === 'sv') s = s.replace('.', ',');
  return s;
}

function formatInSystem(baseVal: number, dim: 'vol' | 'mass', system: UnitSystem): string {
  const ladder = LADDERS[system][dim];
  for (let i = 0; i < ladder.length; i++) {
    const [name, size] = ladder[i];
    if (baseVal >= size - 1e-9 || i === ladder.length - 1) {
      return `${formatNum(baseVal / size, system)} ${name}`;
    }
  }
  return formatNum(baseVal, system);
}

// Match a leading quantity, an optional unit word, then the rest.
const LINE_RE = /^(\s*)([\d.,/¼½¾⅓⅔⅛]+(?:\s+[\d/¼½¾⅓⅔⅛]+)?)\s*([a-zA-ZåäöÅÄÖ.]+)?\s*(.*)$/;

/** Scale one ingredient line by `factor` and render it in `system`. Lines without
 *  a leading number are returned unchanged; an unrecognised unit just scales the
 *  number and keeps the word. */
export function scaleLine(line: string, factor: number, system: UnitSystem): string {
  const m = LINE_RE.exec(line);
  if (!m) return line;
  const qty = parseQty(m[2]);
  if (qty == null) return line;

  const unitToken = (m[3] ?? '').toLowerCase().replace(/\.$/, '');
  const rest = m[4] ?? '';
  const unit = UNITS[unitToken];

  if (unit) {
    const baseVal = qty * unit.base * factor;
    const amount = formatInSystem(baseVal, unit.dim, system);
    return `${amount}${rest ? ' ' + rest : ''}`.trim();
  }

  // No known unit: scale the count, keep the word (which is part of the item).
  const word = m[3] ? m[3] + (rest ? ' ' + rest : '') : rest;
  return `${formatNum(qty * factor, system)}${word ? ' ' + word : ''}`.trim();
}

/** Scale a whole ingredient list. */
export function scaleIngredients(lines: string[], factor: number, system: UnitSystem): string[] {
  return lines.map((l) => scaleLine(l, factor, system));
}
