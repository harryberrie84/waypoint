const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeById<T extends { id: string }>(base: readonly T[], ours: readonly T[], theirs: readonly T[]): T[] {
  const baseById = new Map(base.map((x) => [x.id, x]));
  const oursById = new Map(ours.map((x) => [x.id, x]));
  const theirsById = new Map(theirs.map((x) => [x.id, x]));
  const out: T[] = [];
  for (const o of ours) {
    const b = baseById.get(o.id);
    const t = theirsById.get(o.id);
    if (!b) {
      out.push(o);
      continue;
    }
    if (!t) {
      if (!same(o, b)) out.push(o);
      continue;
    }
    out.push(same(o, b) ? t : o);
  }
  for (const t of theirs) {
    if (!oursById.has(t.id) && !baseById.has(t.id)) out.push(t);
  }
  return out;
}

export function mergeCells<V>(server: Record<string, V>, local: Record<string, V>, changed: Iterable<string>): Record<string, V> {
  const out: Record<string, V> = { ...server };
  for (const k of changed) {
    if (k in local) out[k] = local[k];
    else delete out[k];
  }
  return out;
}
