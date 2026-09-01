// Spaced repetition: the scheduling brain behind the Flashcards tab.
//
// SM-2 with Anki's shape on top of it: sub-day learning steps, cloze deletions,
// reverse cards, sub-decks, leeches, a cram mode and a real answer history.
// Pure, and "now" is always a parameter.
//
// TWO IDEAS CARRY THE WHOLE DESIGN.
//
// 1. SCHEDULING IS PER USER. A deck lives on a shared page; if progress lived on
//    the card then two people reviewing it would overwrite each other and the
//    second to answer would decide when the first saw a card again. Cards hold
//    CONTENT, `deck.users[userId]` holds that person's progress.
//
// 2. THE UNIT OF SCHEDULING IS NOT THE CARD. One note can produce several things
//    to review: a cloze with three deletions is three, a reverse card is two.
//    `unitsOf(card)` expands a card into its review units and everything after
//    that (queue, grading, stats) works on units keyed by `unit.key`. That is
//    what lets cloze and reverse exist at all without a second scheduler.
//
// Days are LOCAL day indices so a card due "tomorrow" appears when tomorrow
// starts for the reviewer. Learning steps are finer than that, so a card still in
// learning also carries an exact `dueMs`.

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface CardMedia {
  /** An uploads url shown above the front / back text. */
  front?: string;
  back?: string;
  /** Audio played on demand, for pronunciation. */
  audio?: string;
}

/** A card is content only. Progress is per user, per unit. */
export interface Card {
  id: string;
  front: string;
  back: string;
  tags?: string[];
  /** Sub-deck name. Empty or absent means the deck's root. */
  deck?: string;
  /** Cloze text, e.g. "Tokyo is the capital of {{c1::Japan}}". When set it
   *  REPLACES front/back and produces one unit per deletion index. */
  cloze?: string;
  /** Also ask back-to-front, as its own unit with its own schedule. */
  reverse?: boolean;
  media?: CardMedia;
}

export interface Sched {
  /** Days between reviews once graduated. 0 while still in learning. */
  interval: number;
  ease: number;
  /** Local day index this is next due. */
  due: number;
  /** Exact time it is next due, used while in learning (steps are minutes). */
  dueMs?: number;
  /** Index into the learning steps, absent once graduated. */
  step?: number;
  reps: number;
  lapses: number;
  suspended?: boolean;
  /** Failed enough times to be worth stopping and rewriting. */
  leech?: boolean;
}

export interface AnswerRecord {
  /** Local day index. */
  d: number;
  g: Grade;
}

export interface DeckState {
  sched: Record<string, Sched>;
  /** day index -> answers that day. Drives the streak. */
  done: Record<string, number>;
  /** Recent answers, newest last. Capped; this is what makes retention real. */
  history?: AnswerRecord[];
}

export interface Deck {
  cards: Card[];
  newPerDay?: number;
  maxPerDay?: number;
  /** Learning steps in MINUTES. Anki's default is 1 then 10. */
  learnSteps?: number[];
  /** Lapses before a unit is called a leech and taken out of rotation. */
  leechAt?: number;
  users?: Record<string, DeckState>;
}

export const MIN_EASE = 1.3;
export const START_EASE = 2.5;
export const MATURE_DAYS = 21;
export const DEFAULT_STEPS = [1, 10];
export const DEFAULT_LEECH_AT = 8;
const DONE_KEEP = 400;
const HISTORY_KEEP = 2000;

export function dayIndex(at: number | Date = Date.now()): number {
  const d = at instanceof Date ? at : new Date(at);
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}

export const emptyDeck = (): Deck => ({ cards: [], newPerDay: 20, maxPerDay: 200, learnSteps: [...DEFAULT_STEPS], leechAt: DEFAULT_LEECH_AT, users: {} });

const emptyState = (): DeckState => ({ sched: {}, done: {}, history: [] });

export function stateOf(deck: Deck, userId: string): DeckState {
  return deck.users?.[userId] ?? emptyState();
}

export const schedOf = (deck: Deck, userId: string, unitKey: string): Sched | undefined => stateOf(deck, userId).sched[unitKey];

// --- review units -----------------------------------------------------------

export interface Unit {
  /** Stable id for scheduling. The card id, plus a suffix for cloze/reverse. */
  key: string;
  cardId: string;
  front: string;
  back: string;
  kind: 'basic' | 'reverse' | 'cloze';
  tags?: string[];
  deck?: string;
  media?: CardMedia;
}

const CLOZE_RE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;

/** Which deletion numbers a cloze text uses, in order, deduplicated. */
export function clozeIndexes(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(CLOZE_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Render a cloze for one deletion number: that deletion becomes the blank (or
 * its hint), every OTHER deletion shows its answer. That is what makes a cloze
 * different from a fill-in-the-blank: the rest of the sentence stays intact.
 */
export function renderCloze(text: string, index: number, reveal: boolean): string {
  return text.replace(CLOZE_RE, (_all, num: string, answer: string, hint?: string) => {
    if (Number(num) !== index) return answer;
    if (reveal) return answer;
    return hint ? `[${hint}]` : '[...]';
  });
}

/** Expand a card into the things that actually get scheduled. */
export function unitsOf(card: Card): Unit[] {
  const base = { cardId: card.id, tags: card.tags, deck: card.deck, media: card.media };
  if (card.cloze && card.cloze.trim()) {
    const idx = clozeIndexes(card.cloze);
    if (!idx.length) return [{ ...base, key: card.id, front: card.cloze, back: card.cloze, kind: 'cloze' }];
    return idx.map((n) => ({
      ...base,
      key: `${card.id}::c${n}`,
      front: renderCloze(card.cloze!, n, false),
      back: renderCloze(card.cloze!, n, true),
      kind: 'cloze' as const,
    }));
  }
  const out: Unit[] = [{ ...base, key: card.id, front: card.front, back: card.back, kind: 'basic' }];
  if (card.reverse) {
    out.push({ ...base, key: `${card.id}::r`, front: card.back, back: card.front, kind: 'reverse' });
  }
  return out;
}

/** Every unit in a deck, optionally narrowed to one sub-deck. */
export function allUnits(deck: Deck, subDeck?: string): Unit[] {
  const out: Unit[] = [];
  for (const card of deck.cards ?? []) {
    if (subDeck && (card.deck ?? '') !== subDeck) continue;
    out.push(...unitsOf(card));
  }
  return out;
}

/** Sub-deck names present, with how many units each holds. */
export function subDecks(deck: Deck): { name: string; units: number }[] {
  const counts = new Map<string, number>();
  for (const card of deck.cards ?? []) {
    const name = card.deck ?? '';
    counts.set(name, (counts.get(name) ?? 0) + unitsOf(card).length);
  }
  return [...counts.entries()]
    .map(([name, units]) => ({ name, units }))
    .sort((a, b) => (a.name === '' ? -1 : b.name === '' ? 1 : a.name.localeCompare(b.name)));
}

// --- upgrading an older deck ------------------------------------------------

/** A card as an older build may have written it: scheduling lived ON the card
 *  before it moved per user. Kept as a type rather than a comment so the
 *  migration below cannot drift from what it is migrating. */
type LegacyCard = Card & { interval?: number; ease?: number; due?: number; reps?: number; lapses?: number; suspended?: boolean };

/**
 * Upgrade a deck written by an older build, losing nothing.
 *
 * Scheduling used to live on the card and be shared by everyone. When it moved
 * per user, a deck already reviewed under the old shape would have read as
 * entirely new: every interval silently back to zero. This hoists any such
 * schedule into `userId`'s own state (the only sensible reading: whoever opens
 * it inherits what used to be shared) and strips it off the card.
 *
 * Idempotent and safe on a modern deck: with nothing legacy to find it returns
 * the deck untouched, so it can be called on every load.
 */
export function migrateDeck(deck: Deck, userId: string): Deck {
  const cards = (deck.cards ?? []) as LegacyCard[];
  const legacy = cards.filter((c) => typeof c.due === 'number' || typeof c.interval === 'number');
  if (!legacy.length) return deck;

  const prev = stateOf(deck, userId);
  const sched: Record<string, Sched> = { ...prev.sched };
  for (const c of legacy) {
    // Never overwrite a schedule this user already has: theirs is newer.
    if (sched[c.id]) continue;
    sched[c.id] = {
      interval: c.interval ?? 0,
      ease: c.ease ?? START_EASE,
      due: c.due ?? dayIndex(),
      reps: c.reps ?? 0,
      lapses: c.lapses ?? 0,
      ...(c.suspended ? { suspended: true } : {}),
    };
  }
  const cleaned: Card[] = cards.map((c) => {
    const { interval, ease, due, reps, lapses, suspended, ...rest } = c;
    void interval; void ease; void due; void reps; void lapses; void suspended;
    return rest;
  });
  return { ...deck, cards: cleaned, users: { ...(deck.users ?? {}), [userId]: { ...prev, sched } } };
}

// --- writing progress -------------------------------------------------------

export function withSched(deck: Deck, userId: string, unitKey: string, sched: Sched | null, answered?: { day: number; grade: Grade }): Deck {
  const prev = stateOf(deck, userId);
  const nextSched = { ...prev.sched };
  if (sched === null) delete nextSched[unitKey];
  else nextSched[unitKey] = sched;

  let done = prev.done;
  let history = prev.history ?? [];
  if (answered) {
    done = { ...done, [String(answered.day)]: (done[String(answered.day)] ?? 0) + 1 };
    const keys = Object.keys(done).sort((a, b) => Number(a) - Number(b));
    if (keys.length > DONE_KEEP) for (const k of keys.slice(0, keys.length - DONE_KEEP)) delete done[k];
    history = [...history, { d: answered.day, g: answered.grade }];
    if (history.length > HISTORY_KEEP) history = history.slice(history.length - HISTORY_KEEP);
  }
  return { ...deck, users: { ...(deck.users ?? {}), [userId]: { sched: nextSched, done, history } } };
}

/** Drop every schedule for units that no longer exist (a card deleted, a cloze
 *  deletion removed), so a long-lived deck does not accumulate dead keys. */
export function pruneSched(deck: Deck, userId: string): Deck {
  const live = new Set(allUnits(deck).map((u) => u.key));
  const prev = stateOf(deck, userId);
  const sched: Record<string, Sched> = {};
  for (const [k, v] of Object.entries(prev.sched)) if (live.has(k)) sched[k] = v;
  return { ...deck, users: { ...(deck.users ?? {}), [userId]: { ...prev, sched } } };
}

// --- grading ----------------------------------------------------------------

/**
 * Apply an answer. Learning steps come first: a new or lapsed unit walks the
 * steps (1 minute, then 10) before it graduates to day intervals, which is why
 * Anki feels like it teaches rather than just tests. "Again" restarts the steps,
 * "Easy" skips them entirely.
 */
export function grade(current: Sched | undefined, answer: Grade, now = Date.now(), deck?: Pick<Deck, 'learnSteps' | 'leechAt'>): Sched {
  const steps = deck?.learnSteps?.length ? deck.learnSteps : DEFAULT_STEPS;
  const leechAt = deck?.leechAt ?? DEFAULT_LEECH_AT;
  const today = dayIndex(now);
  const ease = current?.ease ?? START_EASE;
  const interval = current?.interval ?? 0;
  const reps = (current?.reps ?? 0) + 1;
  const learning = current === undefined || current.step !== undefined;
  const keep = { suspended: current?.suspended };

  if (answer === 'again') {
    const lapses = (current?.lapses ?? 0) + 1;
    const leech = lapses >= leechAt;
    return {
      ...keep,
      interval: 0,
      ease: Math.max(MIN_EASE, ease - 0.2),
      due: today,
      dueMs: now + steps[0] * 60000,
      step: 0,
      reps,
      lapses,
      leech: leech || current?.leech,
      // A leech is taken out of rotation rather than asked forever. Anki does
      // the same, because the tenth failure teaches nothing the ninth did not.
      ...(leech ? { suspended: true } : {}),
    };
  }

  if (learning && answer !== 'easy') {
    const step = (current?.step ?? -1) + (answer === 'good' ? 1 : 0);
    if (step < steps.length) {
      // Still learning: come back in minutes, not days.
      const wait = steps[Math.max(0, step)] * 60000;
      return { ...keep, interval: 0, ease, due: today, dueMs: now + wait, step: Math.max(0, step), reps, lapses: current?.lapses ?? 0, leech: current?.leech };
    }
    // Walked off the end of the steps: graduate.
    return { ...keep, interval: 1, ease, due: today + 1, reps, lapses: current?.lapses ?? 0, leech: current?.leech };
  }

  let nextEase = ease;
  if (answer === 'hard') nextEase = Math.max(MIN_EASE, ease - 0.15);
  if (answer === 'easy') nextEase = ease + 0.15;

  let next: number;
  if (interval === 0) next = answer === 'easy' ? 4 : 1;
  else if (interval === 1) next = answer === 'hard' ? 2 : answer === 'good' ? 3 : 5;
  else {
    const factor = answer === 'hard' ? 1.2 : answer === 'easy' ? nextEase * 1.3 : nextEase;
    next = Math.round(interval * factor);
  }
  next = Math.max(1, Math.min(next, 365 * 10));
  return { ...keep, interval: next, ease: Number(nextEase.toFixed(2)), due: today + next, reps, lapses: current?.lapses ?? 0, leech: current?.leech };
}

/** What each button will do, as a human string, for the hint under it. */
export function gradePreview(current: Sched | undefined, now = Date.now(), deck?: Pick<Deck, 'learnSteps' | 'leechAt'>): Record<Grade, string> {
  const out = {} as Record<Grade, string>;
  for (const g of ['again', 'hard', 'good', 'easy'] as Grade[]) {
    const after = grade(current, g, now, deck);
    if (after.step !== undefined && after.dueMs) {
      const mins = Math.max(1, Math.round((after.dueMs - now) / 60000));
      out[g] = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
    } else {
      const days = after.due - dayIndex(now);
      out[g] = days <= 0 ? 'today' : days === 1 ? '1d' : days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
    }
  }
  return out;
}

export function setDueIn(current: Sched | undefined, days: number, today = dayIndex()): Sched {
  const gap = Math.max(0, Math.round(days));
  return {
    interval: gap,
    ease: current?.ease ?? START_EASE,
    due: today + gap,
    reps: current?.reps ?? 0,
    lapses: current?.lapses ?? 0,
    suspended: current?.suspended,
    leech: current?.leech,
  };
}

// --- the queue --------------------------------------------------------------

export interface Queue {
  due: Unit[];
  counts: { new: number; learning: number; review: number; later: number; suspended: number; leeches: number; total: number };
}

/**
 * What to review now, for one person. Order: units already in learning whose
 * minutes are up, then cards that came due today, then new ones. Learning first
 * because those are mid-lesson and the whole point of a step is that it lands
 * soon; new last because introducing more while a step is pending is how a
 * session runs away from you.
 */
export function buildQueue(deck: Deck, userId: string, now = Date.now(), subDeck?: string): Queue {
  const state = stateOf(deck, userId);
  const today = dayIndex(now);
  const units = allUnits(deck, subDeck);
  const learning: { u: Unit; at: number }[] = [];
  const review: { u: Unit; at: number }[] = [];
  const fresh: Unit[] = [];
  let later = 0;
  let suspended = 0;
  let leeches = 0;

  for (const u of units) {
    const s = state.sched[u.key];
    if (s?.leech) leeches++;
    if (s?.suspended) {
      suspended++;
      continue;
    }
    if (!s) {
      fresh.push(u);
      continue;
    }
    if (s.step !== undefined) {
      if ((s.dueMs ?? 0) <= now) learning.push({ u, at: s.dueMs ?? 0 });
      else later++;
      continue;
    }
    if (s.due <= today) review.push({ u, at: s.due });
    else later++;
  }
  learning.sort((a, b) => a.at - b.at || a.u.key.localeCompare(b.u.key));
  review.sort((a, b) => a.at - b.at || a.u.key.localeCompare(b.u.key));

  const cap = Math.max(0, deck.maxPerDay ?? 200);
  const capped = review.slice(0, cap).map((r) => r.u);
  const intro = fresh.slice(0, Math.max(0, deck.newPerDay ?? 20));
  return {
    due: [...learning.map((l) => l.u), ...capped, ...intro],
    counts: { new: intro.length, learning: learning.length, review: capped.length, later, suspended, leeches, total: units.length },
  };
}

/**
 * Cram: everything matching, scheduling ignored, nothing written back. For the
 * night before, when you want to drill a tag rather than obey the algorithm.
 * Deliberately returns units in a fixed order rather than shuffling, so it can
 * be tested and so leaving and coming back does not restart somewhere random.
 */
export function buildCram(deck: Deck, opts: { subDeck?: string; tag?: string } = {}): Unit[] {
  return allUnits(deck, opts.subDeck).filter((u) => !opts.tag || (u.tags ?? []).includes(opts.tag));
}

export function forecast(deck: Deck, userId: string, days = 14, today = dayIndex()): number[] {
  const state = stateOf(deck, userId);
  const out = new Array(days).fill(0);
  for (const u of allUnits(deck)) {
    const s = state.sched[u.key];
    if (!s || s.suspended) continue;
    const offset = Math.max(0, s.due - today);
    if (offset < days) out[offset] += 1;
  }
  return out;
}

// --- stats ------------------------------------------------------------------

export interface DeckStats {
  total: number;
  unseen: number;
  learning: number;
  young: number;
  mature: number;
  suspended: number;
  leeches: number;
  reviewsToday: number;
  streak: number;
  /** From the real answer log: answers that were not "again", as a percentage. */
  retention: number | null;
  /** Answers per day over the requested window, oldest first. */
  recent: number[];
}

export function deckStats(deck: Deck, userId: string, today = dayIndex(), window = 30): DeckStats {
  const state = stateOf(deck, userId);
  let unseen = 0;
  let learning = 0;
  let young = 0;
  let mature = 0;
  let suspended = 0;
  let leeches = 0;
  for (const u of allUnits(deck)) {
    const s = state.sched[u.key];
    if (s?.suspended) suspended++;
    if (s?.leech) leeches++;
    if (!s) {
      unseen++;
      continue;
    }
    if (s.step !== undefined || s.interval === 0) learning++;
    else if (s.interval >= MATURE_DAYS) mature++;
    else young++;
  }
  let streak = 0;
  for (let d = today; ; d--) {
    if ((state.done[String(d)] ?? 0) > 0) streak++;
    else break;
  }
  const history = state.history ?? [];
  const graded = history.length;
  const kept = history.filter((h) => h.g !== 'again').length;
  const recent = new Array(window).fill(0);
  for (const h of history) {
    const offset = window - 1 - (today - h.d);
    if (offset >= 0 && offset < window) recent[offset] += 1;
  }
  return {
    total: allUnits(deck).length,
    unseen,
    learning,
    young,
    mature,
    suspended,
    leeches,
    reviewsToday: state.done[String(today)] ?? 0,
    streak,
    retention: graded > 0 ? Math.round((kept / graded) * 100) : null,
    recent,
  };
}
