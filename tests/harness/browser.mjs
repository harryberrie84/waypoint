import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT, SOURCE, startPocketBase } from './pocketbase.mjs';

let built = null;

export function buildApp() {
  if (process.env.WAYPOINT_DIST) return process.env.WAYPOINT_DIST;
  if (built) return built;
  const out = join(ROOT, '.cache', 'e2e-dist');
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: SOURCE, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('vite build failed');
  built = out;
  return out;
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (base && existsSync(base)) {
      for (const d of readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
        const exe = join(base, d, 'chrome-linux', 'chrome');
        if (existsSync(exe)) return chromium.launch({ executablePath: exe });
      }
    }
    throw e;
  }
}

const IGNORED = [/open\.er-api\.com/, /api\.frankfurter/, /open-meteo/, /nominatim/, /tile\.openstreetmap/];

export async function startApp(options = {}) {
  const pb = await startPocketBase({ ...options, publicDir: buildApp() });
  const browser = await launch();
  const problems = [];
  const contexts = [];
  const watch = (page, who) => {
    page.on('response', (r) => {
      const u = r.url();
      if (r.status() >= 400 && u.startsWith(pb.url) && !IGNORED.some((re) => re.test(u))) {
        problems.push(`${who}: ${r.status()} ${r.request().method()} ${u.replace(pb.url, '')}`);
      }
    });
    page.on('pageerror', (e) => problems.push(`${who}: page error ${e.message}`));
  };
  const newPage = async (who = 'user', viewport = { width: 1400, height: 900 }) => {
    const ctx = await browser.newContext({ viewport });
    contexts.push(ctx);
    const page = await ctx.newPage();
    watch(page, who);
    return page;
  };
  const stop = async () => {
    await browser.close().catch(() => {});
    await pb.stop();
  };
  return { pb, browser, newPage, watch, problems, stop };
}

let counter = 0;
export async function registerInUi(page, url, name, givenEmail, startPath = '/') {
  const email = givenEmail || `${name}-${Date.now().toString(36)}${(counter++).toString(36)}@example.org`;
  await page.goto(url + startPath);
  await page.getByRole('button', { name: 'Create account' }).first().click();
  await page.getByPlaceholder('Alex Rivera').fill(name);
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('At least 8 characters').fill('Passw0rd!2345');
  await page.getByRole('button', { name: /create account/i }).last().click();
  await page.getByTitle('Sign out').waitFor({ timeout: 20000 });
  return { email, password: 'Passw0rd!2345', name };
}

export async function signInInUi(page, url, email, password = 'Passw0rd!2345') {
  await page.goto(url + '/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Your password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).last().click();
  await page.getByTitle('Sign out').waitFor({ timeout: 20000 });
}

export async function pickStarter(page, label) {
  await page.getByText(label, { exact: true }).click();
  await page.locator('.ProseMirror').first().waitFor({ timeout: 15000 });
}

export function sidebar(page) {
  return page.locator('nav').first();
}

export async function sidebarText(page) {
  return (await sidebar(page).innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
}

export async function waitFor(fn, what, timeout = 10000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? ': ' + last.message : ''}`);
}

export async function editorText(page) {
  return page.locator('.ProseMirror').first().innerText();
}

export async function settled(page, selector, quietMs = 700, timeout = 15000) {
  await page.locator(selector).first().waitFor({ timeout });
  await page.evaluate(({ selector, quietMs, timeout }) => new Promise((resolve, reject) => {
    let el = document.querySelector(selector);
    let since = performance.now();
    const until = performance.now() + timeout;
    const tick = () => {
      const now = document.querySelector(selector);
      if (now !== el) { el = now; since = performance.now(); }
      if (el && performance.now() - since >= quietMs) return resolve();
      if (performance.now() > until) return reject(new Error(`${selector} kept being replaced`));
      setTimeout(tick, 50);
    };
    tick();
  }), { selector, quietMs, timeout });
}
