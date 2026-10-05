import { startApp, registerInUi, pickStarter, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: a server without the add-on hooks still saves everything');
  const app = await startApp({ onlyHooks: [] });
  const api = client(app.pb.url);
  try {
    const page = await app.newPage('solo');
    await registerInUi(page, app.pb.url, 'solo');
    await pickStarter(page, 'blank page');

    await check('a title and a body typed on a server without the hooks are there after a reload',
      'A server whose hooks were not updated with the bundle (copied by hand, or none at all) answers the save route with 404. Saves must fall back, not vanish.',
      async () => {
        await page.locator('main input').first().fill('Hookless');
        const ed = page.locator('.ProseMirror[contenteditable="true"]').first();
        await ed.click();
        await page.keyboard.type('kept without hooks');
        await waitFor(async () => (await sidebar(page).innerText()).includes('Hookless'), 'the title in the sidebar');
        await page.waitForTimeout(1500);
        await page.reload();
        await page.getByTitle('Sign out').waitFor();
        await sidebar(page).getByText('Hookless', { exact: true }).first().click();
        await waitFor(async () => (await page.locator('.ProseMirror').first().innerText()).includes('kept without hooks'), 'the body after a reload', 15000);
        const token = await page.evaluate(() => JSON.parse(localStorage.getItem('pocketbase_auth') || '{}').token);
        const pages = await api.list('pages', token);
        ok(pages.some((p) => p.title === 'Hookless'), `the title on the server: ${JSON.stringify(pages.map((p) => p.title))}`);
      });

    await check('a table cell typed on a server without the hooks is saved',
      'Cells are saved by merging only the changed ones on the server. A server without that hook (or with an older one) ignores the merge, and the app must notice and save the way it did before.',
      async () => {
        const ed = page.locator('.ProseMirror[contenteditable="true"]').first();
        await ed.click();
        await page.keyboard.press('Control+End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('/table');
        await page.locator('div[style*="z-index: 1300"] button', { hasText: 'Relational database' }).click();
        await page.getByText('New row').first().waitFor();
        await page.locator('table tbody tr').first().locator('input').first().fill('Ferry without hooks');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(2500);
        const token = await page.evaluate(() => JSON.parse(localStorage.getItem('pocketbase_auth') || '{}').token);
        const rows = await api.list('table_rows', token);
        ok(rows.some((r) => Object.values(r.cells ?? {}).includes('Ferry without hooks')), `the cell on the server: ${JSON.stringify(rows.map((r) => r.cells))}`);
      });

    await check('the only refused requests were the missing routes being probed',
      'Anything else refused here is a real failure on such a server.',
      async () => {
        ok(app.problems.some((p) => /404 PATCH \/api\/waypoint\/save\//.test(p)), 'the save route was never tried, so the fallback was not exercised');
        eq(app.problems.filter((p) => !/\/api\/waypoint\//.test(p)), [], 'failed requests or page errors');
      });
  } finally {
    await app.stop();
  }
}
