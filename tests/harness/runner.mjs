let passed = 0;
let failed = 0;
const failures = [];

export function suite(name) {
  console.log(`\n${name}`);
}

export async function check(name, why, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log(`FAIL  ${name}`);
    console.log(`      why it matters: ${why}`);
    console.log(`      ${String(e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)}`);
  }
}

export function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

export function ok(cond, what) {
  if (!cond) throw new Error(what);
}

export function summary() {
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed) console.log(`failed:\n  ${failures.join('\n  ')}`);
  return failed === 0;
}
