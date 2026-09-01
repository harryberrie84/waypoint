// Bracket: a single-elimination tournament that advances winners.
//
// The whole structure is derived from the entrant list and a map of match ->
// winner. Nothing about who plays whom in round 2 is stored, because storing it
// means it can disagree with round 1, and a bracket that disagrees with itself is
// worse than no bracket. Change an early result and everything downstream
// recomputes, dropping any later pick that is no longer reachable.
//
// Pure, deterministic, no store.

export interface BracketData {
  title?: string;
  entrants: string[];
  /** matchId -> the name that won it. */
  results: Record<string, string>;
}

export interface Match {
  id: string;
  round: number;
  /** Position within the round, 0-based. */
  index: number;
  /** Null while the feeding match has no winner yet. */
  a: string | null;
  b: string | null;
  winner: string | null;
  /** A slot with no opponent: the entrant walks through. */
  bye: boolean;
}

export const emptyBracket = (): BracketData => ({ entrants: [], results: {} });

export const matchId = (round: number, index: number): string => `r${round}m${index}`;

/** Next power of two at or above n, minimum 2. */
function slots(n: number): number {
  let s = 2;
  while (s < n) s *= 2;
  return s;
}

/**
 * Standard seeding: 1 plays the lowest seed, 2 plays the second lowest, and the
 * halves stay apart until the final. Byes fall to the top seeds, which is what
 * makes a 5-entrant bracket feel right instead of arbitrary.
 */
export function seedOrder(count: number): number[] {
  let order = [0];
  while (order.length < count) {
    const size = order.length * 2;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed);
      next.push(size - 1 - seed);
    }
    order = next;
  }
  return order;
}

/**
 * The whole bracket, round by round. Round 0 is the first round; the last round
 * holds the final. Every match's participants come from the results of the two
 * that feed it, so this is the single source of truth for the shape.
 */
export function buildBracket(data: BracketData): Match[][] {
  const entrants = (data.entrants ?? []).filter((e) => e.trim() !== '');
  if (entrants.length < 2) return [];
  const size = slots(entrants.length);
  const order = seedOrder(size);
  // Seat the entrants into their seeded slots; the empty slots become byes.
  const seats: (string | null)[] = order.map((seed) => entrants[seed] ?? null);

  const rounds: Match[][] = [];
  let previous: Match[] = [];
  // A bracket of `size` slots has exactly log2(size) rounds; the loop is bounded
  // by that rather than by a condition, so it cannot run away on a bad input.
  const roundCount = Math.log2(size);
  for (let round = 0; round < roundCount; round++) {
    const width = size / 2 ** (round + 1);
    if (width < 1) break;
    const matches: Match[] = [];
    for (let i = 0; i < width; i++) {
      let a: string | null;
      let b: string | null;
      if (round === 0) {
        a = seats[i * 2] ?? null;
        b = seats[i * 2 + 1] ?? null;
      } else {
        a = previous[i * 2]?.winner ?? null;
        b = previous[i * 2 + 1]?.winner ?? null;
      }
      const id = matchId(round, i);
      // A bye exists ONLY in the first round, where an empty slot means there is
      // no such entrant. In every later round an empty slot means the match that
      // feeds it has not been decided yet, and treating that as a bye advances
      // one semi-finalist straight past the final and crowns them early.
      const bye = round === 0 && (a === null) !== (b === null);
      const auto = bye ? (a ?? b) : null;
      const picked = data.results?.[id] ?? null;
      // A stored result that no longer matches either participant is stale (an
      // earlier round changed under it) and is ignored rather than shown.
      const valid = picked !== null && (picked === a || picked === b) ? picked : null;
      matches.push({ id, round, index: i, a, b, winner: auto ?? valid, bye });
    }
    rounds.push(matches);
    previous = matches;
    if (width === 1) break;
  }
  return rounds;
}

/** The winner of the final, once there is one. */
export function champion(data: BracketData): string | null {
  const rounds = buildBracket(data);
  if (!rounds.length) return null;
  const final = rounds[rounds.length - 1][0];
  return final?.winner ?? null;
}

/** Record a pick, then drop every stored result that it just made unreachable,
 *  so the saved data never carries a match that cannot happen. */
export function pickWinner(data: BracketData, id: string, name: string): BracketData {
  const next: BracketData = { ...data, results: { ...(data.results ?? {}), [id]: name } };
  const live = new Set(buildBracket(next).flat().map((m) => m.id));
  const pruned: Record<string, string> = {};
  for (const rounds of buildBracket(next)) {
    for (const m of rounds) {
      const stored = next.results[m.id];
      if (stored && (stored === m.a || stored === m.b) && live.has(m.id)) pruned[m.id] = stored;
    }
  }
  return { ...next, results: pruned };
}

/** How far each entrant got, for the standings list. Round numbers are 0-based,
 *  so `reached` is how many rounds they won. */
export function standings(data: BracketData): { name: string; reached: number; out: boolean }[] {
  const rounds = buildBracket(data);
  const reached = new Map<string, number>();
  for (const entrant of data.entrants ?? []) reached.set(entrant, 0);
  for (const round of rounds) {
    for (const m of round) {
      if (m.winner) reached.set(m.winner, (reached.get(m.winner) ?? 0) + 1);
    }
  }
  const decided = new Set<string>();
  for (const round of rounds) {
    for (const m of round) {
      if (!m.winner || m.bye) continue;
      const loser = m.winner === m.a ? m.b : m.a;
      if (loser) decided.add(loser);
    }
  }
  return [...reached.entries()]
    .map(([name, n]) => ({ name, reached: n, out: decided.has(name) }))
    .sort((x, y) => y.reached - x.reached || x.name.localeCompare(y.name));
}
