// One-shot verification: typecheck, pure tests, lint, and a sanity pass over the
// static assets that the build harness can't reach (manifest, icons, schema).
// Run: npm run check   (add --build to also run the full vite build)
//
// Each step streams its own output; a final line says how many passed. Exits
// non-zero if anything failed, so it doubles as a pre-ship gate and a CI command.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const node = process.execPath;
const wantBuild = process.argv.includes('--build');

function sh(args) {
  return spawnSync(node, args, { stdio: 'inherit' }).status === 0;
}

// A stray NUL byte in a source file. It slips through everything else: tsc parses
// it, the tests pass, and the app runs, because it usually lands inside a string
// literal where it still behaves like a character. What it does break is git, which
// then treats the whole file as BINARY, so the diff is unreviewable and a merge is
// a coin toss. Two of these were already in the tree before anyone noticed.
function checkSourceBytes() {
  let ok = true;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (/\.(ts|tsx|mjs|js|json|css|md)$/.test(entry)) {
        const buf = readFileSync(p);
        const at = buf.indexOf(0);
        if (at !== -1) {
          const line = buf.subarray(0, at).toString('utf8').split('\n').length;
          console.log(`      NUL byte in ${p}:${line} (git will treat this file as binary)`);
          ok = false;
        }
        // Double-encoded UTF-8. Editing a file through a tool that round-trips it
        // through a legacy codepage mangles every multi-byte character, and it then
        // ships and shows up in the UI as a stray character nobody can explain.
        //
        // The pattern is written with \u escapes so this file stays pure ASCII.
        // Spelling the sequences out literally would make the check fail on itself,
        // which it duly did.
        const m = /[\u00C2\u00C3][\u0080-\u00BF]|\u00E2\u0080|\uFFFD/.exec(buf.toString('utf8'));
        if (m) {
          console.log(`      mojibake in ${p} near "${m[0]}" (a UTF-8 string was re-encoded through a legacy codepage)`);
          ok = false;
        }
      }
    }
  };
  for (const dir of ['src', 'scripts', 'server']) if (existsSync(dir)) walk(dir);
  return ok;
}

// Things the pure tests don't see: the PWA shell and the PocketBase schema.
function checkAssets() {
  let ok = true;
  const fail = (m) => {
    console.log('      ' + m);
    ok = false;
  };

  try {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    for (const k of ['name', 'start_url', 'display', 'icons']) if (!(k in m)) fail(`manifest missing "${k}"`);
    if (!Array.isArray(m.icons) || m.icons.length === 0) fail('manifest has no icons');
    for (const icon of m.icons ?? []) {
      const path = 'public' + icon.src;
      if (!existsSync(path)) fail(`manifest icon not found: ${path}`);
    }
  } catch (e) {
    fail('manifest.webmanifest: ' + e.message);
  }

  for (const f of ['public/sw.js', 'public/icon.svg', 'public/icon-maskable.svg']) {
    if (!existsSync(f)) fail(`missing ${f}`);
  }

  // The fonts are bundled on purpose: a missing woff2 means the app silently
  // falls back to the system stack, and nobody notices until a screenshot.
  // A stray CDN reference is the other half of the same check.
  const fontFiles = existsSync('public/fonts') ? readdirSync('public/fonts') : [];
  if (!fontFiles.some((f) => f.endsWith('.woff2'))) fail('public/fonts has no woff2 files');
  for (const f of ['public/fonts/extra.css', 'public/fonts/OFL.txt', 'public/fonts/LICENSES.md']) {
    if (!existsSync(f)) fail(`missing ${f}`);
  }
  for (const f of ['index.html', 'src/index.css', 'public/sw.js']) {
    if (/fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, 'utf8'))) fail(`${f} still points at a font CDN`);
  }

  try {
    const schema = JSON.parse(readFileSync('pocketbase/schema.json', 'utf8'));
    if (!Array.isArray(schema)) fail('schema.json is not an array');
    else if (!schema.some((c) => c.name === 'pages')) fail('schema.json has no pages collection');
  } catch (e) {
    fail('schema.json: ' + e.message);
  }

  return ok;
}

const steps = [
  { name: 'typecheck', run: () => sh(['node_modules/typescript/bin/tsc', '-b']) },
  { name: 'tests', run: () => sh(['--import', './scripts/register.mjs', 'scripts/tests.ts']) },
  { name: 'lint', run: () => sh(['node_modules/oxlint/bin/oxlint']) },
  { name: 'schema', run: () => sh(['scripts/gen-schema.mjs', '--check']) },
  { name: 'assets', run: checkAssets },
  { name: 'source bytes', run: checkSourceBytes },
];
if (wantBuild) steps.push({ name: 'build', run: () => sh(['node_modules/vite/bin/vite.js', 'build']) });

let failed = 0;
for (const step of steps) {
  process.stdout.write(`\n==> ${step.name}\n`);
  if (step.run()) {
    console.log(`  ok  ${step.name}`);
  } else {
    console.log(`FAIL  ${step.name}`);
    failed++;
  }
}

console.log(`\n${steps.length - failed}/${steps.length} checks passed`);
process.exit(failed ? 1 : 0);
