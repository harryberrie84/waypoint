// Dev-only loader: lets Node's native TS type-stripping resolve the repo's
// extensionless relative imports (`from '../types'`) when running test scripts.
// Not shipped, tests are run from source, never bundled.
export async function resolve(specifier, context, nextResolve) {
  if (/^\.{1,2}\//.test(specifier) && !/\.(ts|tsx|js|mjs|json)$/.test(specifier)) {
    try { return await nextResolve(specifier + '.ts', context); } catch { /* fall through */ }
  }
  return nextResolve(specifier, context);
}
