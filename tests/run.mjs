import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './harness/pocketbase.mjs';
import { summary } from './harness/runner.mjs';

const kinds = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
if (!kinds.length) kinds.push('server', 'e2e');

for (const kind of kinds) {
  const dir = join(ROOT, 'tests', kind);
  const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!only || f.includes(only))).sort();
  for (const f of files) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    await mod.default();
  }
}
process.exit(summary() ? 0 : 1);
