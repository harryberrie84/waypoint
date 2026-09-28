import { startApp, registerInUi, signInInUi, pickStarter, sidebar, waitFor, settled } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';
import { client } from '../harness/api.mjs';

const values = async (page) => page.locator('table tbody input:not([type=checkbox])').evaluateAll((els) => els.map((e) => e.value));

export default async function () {
  suite('browser: tables');
  const app = await startApp();
  const url = app.pb.url;
  try {
    const page = await app.newPage('owner');
    const tableWrites = [];
    page.on('request', (r) => { if (/collections\/tables\/records/.test(r.url()) && r.method() !== 'GET') tableWrites.push(`${r.method()} ${(r.postData() || '').slice(0, 80)}`); });
    const who = await registerInUi(page, url, 'tables');
    await pickStarter(page, 'blank page');
    await page.locator('main input').first().fill('Money');
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type('/table');
    await page.locator('div[style*="z-index: 1300"] button', { hasText: 'Relational database' }).click();
    await page.getByText('New row').first().waitFor();

    await check('rows and cells you type are still there after a reload',
      'A table is a small database; a cell that does not survive a reload is data loss that looks like success.',
      async () => {
        const first = page.locator('table tbody tr').first().locator('input').first();
        await first.click();
        await first.fill('Ferry tickets');
        await page.locator('table tbody tr').first().locator('input[inputmode=decimal]').fill('450');
        await page.getByText('New row').first().click();
        await waitFor(async () => (await page.locator('table tbody tr').count()) === 2, 'a second row');
        const second = page.locator('table tbody tr').nth(1).locator('input').first();
        await second.click();
        await second.fill('Hostel');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(2500);
        await page.reload();
        await page.getByText('New row').first().waitFor({ timeout: 15000 });
        await settled(page, 'input[placeholder="Table name"]');
        await waitFor(async () => {
          const v = await values(page);
          return v.includes('Ferry tickets') && v.includes('Hostel') && v.some((x) => x.replace(/\s/g, '').startsWith('450'));
        }, 'the typed cells after a reload', 15000);
      });

    await check('a table lines up with the text around it instead of running past it',
      'Tables and other blocks were wider than the text column, so a page read as a narrow column with things sticking out to the right. A wide table scrolls inside its own box instead.',
      async () => {
        const edges = async () => page.evaluate(() => {
          const root = document.querySelector('.tiptap');
          const text = [...root.children].find((c) => c.tagName === 'P' || /^H[1-3]$/.test(c.tagName));
          const limit = text.getBoundingClientRect().right;
          const over = [...root.children].filter((c) => c.getBoundingClientRect().right > limit + 1).map((c) => c.className || c.tagName);
          return { over, pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        const wide = await edges();
        eq(wide.over, [], 'blocks past the text column at desktop width');
        ok(wide.pageScroll <= 0, `the page scrolls sideways by ${wide.pageScroll}px at desktop width`);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(400);
        const narrow = await edges();
        eq(narrow.over, [], 'blocks past the text column at phone width');
        ok(narrow.pageScroll <= 0, `the page scrolls sideways by ${narrow.pageScroll}px at phone width`);
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.waitForTimeout(400);
      });

    await check('renaming a table sticks',
      'Linked views and the sidebar find tables by name.',
      async () => {
        await settled(page, 'input[placeholder="Table name"]');
        const name = page.locator('input[placeholder="Table name"]').first();
        await name.fill('Budget');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(2000);
        await page.reload();
        await page.locator('input[placeholder="Table name"]').first().waitFor({ timeout: 15000 });
        try {
          await waitFor(async () => (await page.locator('input[placeholder="Table name"]').first().inputValue()) === 'Budget', 'the new table name after a reload');
        } catch (e) {
          const api = client(url);
          const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: who.email, password: who.password }), 'token');
          const server = (await api.list('tables', auth.token)).map((t) => t.name);
          const shown = await page.locator('input[placeholder="Table name"]').first().inputValue();
          throw new Error(`${e.message}; the server has ${JSON.stringify(server)}, the page shows "${shown}"; table writes: ${JSON.stringify(tableWrites)}`);
        }
      });

    await check('a view switched to Board is a Board on another device too',
      'The view setting was kept only in the browser that set it, because the server silently dropped it; a colleague or your phone saw the old view.',
      async () => {
        await page.getByRole('button', { name: 'Board', exact: true }).first().click();
        await page.waitForTimeout(2500);
        const other = await app.newPage('other device');
        await signInInUi(other, url, who.email);
        await sidebar(other).getByText('Money', { exact: true }).first().click();
        await other.locator('input[placeholder="Table name"]').first().waitFor({ timeout: 15000 });
        await waitFor(async () => (await other.locator('table').count()) === 0 && (await other.getByText('needs a Select or Person column').count()) > 0, 'the board, not the grid, on the other device', 15000);
      });

    await check('nothing along the way was refused by the server',
      'A refused save is invisible in the UI and lost on reload.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
