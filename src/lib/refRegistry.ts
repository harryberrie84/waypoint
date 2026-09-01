// A live registry of named values that widgets publish so formulas can read them,
// the same idea as the countdown counter generalised to anything: a countdown's
// days-to-go, a budget's total, a person's net in a budget. A module singleton,
// like the fx rates. Widgets publish as they render and tick; tables and inline
// formulas subscribe and recompute when a value changes. Keys are matched
// case-insensitively and trimmed, namespaced so a budget and a countdown can share
// a label without colliding.

const values = new Map<string, number>();
const subs = new Set<() => void>();
let version = 0;

function keyOf(ns: string, key: string): string {
  return `${ns}${key.trim().toLowerCase()}`;
}

export function publishRef(ns: string, key: string, value: number): void {
  if (!key.trim() || !Number.isFinite(value)) return;
  const k = keyOf(ns, key);
  if (values.get(k) === value) return;
  values.set(k, value);
  version++;
  subs.forEach((cb) => cb());
}

export function clearRef(ns: string, key: string): void {
  const k = keyOf(ns, key);
  if (values.delete(k)) {
    version++;
    subs.forEach((cb) => cb());
  }
}

export function lookupRef(ns: string, key: string): number | undefined {
  return values.get(keyOf(ns, key));
}

export function subscribeRefs(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function refsVersion(): number {
  return version;
}
