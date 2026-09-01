import type { Column, CellValue } from '../types';
import { geoOf, attachmentOf } from './tableQuery';

// ---------------------------------------------------------------------------
// formBlock, text ⇄ structure for the :::form[key]::: representation. A form's
// real source of truth is its backing table (columns = schema, a row = values);
// this module only renders that to a readable, paste-able block and parses one
// back. Pure: no React, no store.
//
//   :::form[travel-stop]
//   name: Louvre Museum Tour
//   date: 2026-07-01
//   confirmation: LV-99281A
//   :::
//
// Field keys are slugified column names, disambiguated so two columns never
// collide on one slug. Values render per type: dates ISO, person as user *ids*
// (round-trips losslessly, names would need the roster this pure module can't
// see), select/multiselect as their human labels (readable; the block resolves
// them back on paste).
// ---------------------------------------------------------------------------

export function slugifyField(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'field';
}

// Slugs for a set of names, with collisions disambiguated (`foo`, `foo_2`, …).
// Stable: same input order → same output, so re-serialization round-trips.
export function slugifyFields(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = slugifyField(name);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

function renderValue(col: Column, v: CellValue): string {
  switch (col.type) {
    case 'checkbox':
      return v === true ? 'true' : '';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
    case 'place':
      return geoOf(v)?.name ?? '';
    case 'attachment':
      return attachmentOf(v)?.name ?? ''; // files don't ride along in text, name only
    case 'person':
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join(', ') : '';
    case 'multiselect': {
      const ids = Array.isArray(v) ? v : [];
      return ids
        .map((id) => (col.options ?? []).find((o) => o.id === id)?.label ?? '')
        .filter(Boolean)
        .join(', ');
    }
    case 'select': {
      const opt = (col.options ?? []).find((o) => o.id === v);
      return opt ? opt.label : '';
    }
    default:
      return typeof v === 'string' ? v : v == null ? '' : String(v);
  }
}

// Ordered slug→value pairs for a form's schema + a row's cells. Empty values are
// dropped so the block reads clean; the field still exists in the schema.
export function formValues(columns: Column[], cells: Record<string, CellValue>): { slug: string; value: string }[] {
  const slugs = slugifyFields(columns.map((c) => c.name));
  const out: { slug: string; value: string }[] = [];
  columns.forEach((col, i) => {
    const value = renderValue(col, cells[col.id] ?? null);
    if (value !== '') out.push({ slug: slugs[i], value });
  });
  return out;
}

function renderForm(key: string, fields: { slug: string; value: string }[]): string {
  const lines = fields.map((f) => `${f.slug}: ${f.value}`);
  return [`:::form[${key}]`, ...lines, ':::'].join('\n');
}

export function serializeForm(columns: Column[], cells: Record<string, CellValue>, key: string): string {
  return renderForm(key, formValues(columns, cells));
}

export interface ParsedForm {
  key: string;
  values: { slug: string; value: string }[]; // ordered; unknown-to-schema keys kept as-is so nothing is lost
}

const FORM_RE = /:::form\[([^\]]+)\]\s*\r?\n([\s\S]*?)\r?\n?:::/;

export function parseForm(text: string): ParsedForm | null {
  const m = FORM_RE.exec(text);
  if (!m) return null;
  const key = m[1].trim();
  const values: { slug: string; value: string }[] = [];
  for (const raw of m[2].split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const slug = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (slug) values.push({ slug, value });
  }
  return { key, values };
}
