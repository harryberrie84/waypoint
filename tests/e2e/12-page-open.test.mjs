import { startApp, signInInUi, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const slowRelay = async (page, ms) => {
  await page.route('**/api/collections/yupdates/records**', async (route) => {
    if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, ms));
    await route.continue().catch(() => {});
  });
};

export default async function () {
  suite('browser: opening a page on a slow connection');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const me = await api.signup('me');
    const ws = await api.workspace(me);
    const columns = [{ id: 'cname', name: 'Name', type: 'text', width: 200 }];
    const table = await api.must(api.create('tables', { name: 'Lines', columns, workspace: ws.id, views: { id: 'default', name: 'Grid', type: 'grid', filters: [], sorts: [] } }, me.token), 'table');
    const row = await api.must(api.create('table_rows', { table: table.id, cells: { cname: 'first' }, position: 0, workspace: ws.id }, me.token), 'row');
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Opening line.' }] }, { type: 'tableEmbed', attrs: { tableId: table.id } }] };
    await api.must(api.create('pages', { title: 'Slow', workspace: ws.id, owner: me.id, order: 0, parent: '', content }, me.token), 'page');
    await api.must(api.create('pages', { title: 'Aaa start', workspace: ws.id, owner: me.id, order: -1, parent: '', content: { type: 'doc', content: [{ type: 'paragraph' }] } }, me.token), 'start page');

    const page = await app.newPage('me');
    await signInInUi(page, url, me.email);

    await check('while a page is still connecting, nothing on it can be typed into',
      'Table cells stayed live during the read-only preview; the editor then swapped in and a half-typed cell was thrown away.',
      async () => {
        await slowRelay(page, 3000);
        await sidebar(page).getByText('Slow', { exact: true }).first().click();
        const cell = page.locator('table tbody input:not([type=checkbox])').first();
        await cell.waitFor({ timeout: 15000 });
        ok(await page.locator('.ProseMirror[contenteditable="false"]').count() > 0, 'the preview is showing');
        ok(await cell.isDisabled(), 'a table cell accepted input during the preview');
        await waitFor(async () => (await page.locator('.ProseMirror[contenteditable="true"]').count()) > 0, 'the live editor', 15000);
        const live = page.locator('table tbody input:not([type=checkbox])').first();
        await waitFor(async () => !(await live.isDisabled()), 'cells unlocked once live');
        await live.fill('first, edited');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(2500);
        const saved = await api.get('table_rows', row.id, me.token);
        eq(saved.data?.cells?.cname, 'first, edited', 'the edit made once live is saved');
        await page.unroute('**/api/collections/yupdates/records**');
      });

    await check('a page already opened on this device is editable straight away, even on a slow connection',
      'Every page open waited up to four seconds for the server before allowing a keystroke, even when this device already held the page.',
      async () => {
        await sidebar(page).getByText('Aaa start', { exact: true }).first().click();
        await page.waitForTimeout(500);
        await page.goto(url + '/');
        await page.getByTitle('Sign out').waitFor({ timeout: 20000 });
        await slowRelay(page, 3000);
        const t0 = Date.now();
        await sidebar(page).getByText('Slow', { exact: true }).first().click();
        await waitFor(async () => (await page.locator('.ProseMirror[contenteditable="true"]').count()) > 0, 'the live editor', 15000);
        const took = Date.now() - t0;
        ok(took < 2000, `editable after ${took} ms with a 3 s slow server`);
        await page.locator('.ProseMirror[contenteditable="true"] p').first().click();
        await page.keyboard.press('End');
        await page.keyboard.type(' Typed early.');
        await page.unroute('**/api/collections/yupdates/records**');
        await page.waitForTimeout(5000);
        await page.reload();
        await waitFor(async () => (await page.locator('.ProseMirror').first().innerText()).includes('Opening line. Typed early.'), 'the early typing after a reload', 20000);
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused save during a slow open is invisible and lost.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
