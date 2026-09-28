import { startApp, signInInUi, sidebar, waitFor, settled } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: a formula per cell');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const me = await api.signup('me');
    const ws = await api.workspace(me);
    const columns = [
      { id: 'cname', name: 'Name', type: 'text', width: 160 },
      { id: 'ca', name: 'A', type: 'number', width: 100 },
      { id: 'cd', name: 'Double', type: 'formula', width: 120, formula: '[A] * 2' },
    ];
    const table = await api.must(api.create('tables', { name: 'Numbers', columns, workspace: ws.id, views: { id: 'default', name: 'Grid', type: 'grid', filters: [], sorts: [] } }, me.token), 'table');
    const rowX = await api.must(api.create('table_rows', { table: table.id, cells: { cname: 'x', ca: 5 }, position: 0, workspace: ws.id }, me.token), 'row x');
    const rowY = await api.must(api.create('table_rows', { table: table.id, cells: { cname: 'y', ca: 1 }, position: 1, workspace: ws.id }, me.token), 'row y');
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Some numbers.' }] }, { type: 'tableEmbed', attrs: { tableId: table.id } }] };
    await api.must(api.create('pages', { title: 'Sums', workspace: ws.id, owner: me.id, order: 0, parent: '', content }, me.token), 'page');

    const page = await app.newPage('me');
    await signInInUi(page, url, me.email);
    await sidebar(page).getByText('Sums', { exact: true }).first().click();
    await page.locator('table tbody tr').nth(1).waitFor({ timeout: 15000 });
    await settled(page, 'input[placeholder="Table name"]');
    const formulaCell = (i) => page.locator('table tbody tr').nth(i).locator('button[title*="formula"]').first();

    await check('one cell in a formula column can have its own formula without changing the others',
      'A column used to force the same formula on every row; an exception (a discount, a fixed fee) meant a second column or a wrong total.',
      async () => {
        eq((await formulaCell(1).innerText()).trim(), '2', 'y before');
        await formulaCell(1).click();
        const input = page.getByRole('textbox', { name: /Formula for this Double cell/ });
        await input.fill('[A] * 100');
        await input.press('Enter');
        await waitFor(async () => (await formulaCell(1).innerText()).trim() === '100', 'y shows its own result');
        eq((await formulaCell(0).innerText()).trim(), '10', 'x still uses the column formula');
      });

    await check('the cell keeps its own formula after a reload, and only that cell is marked',
      'An override that does not survive a reload silently changes a total back.',
      async () => {
        await page.waitForTimeout(2500);
        await page.reload();
        await page.locator('table tbody tr').nth(1).waitFor({ timeout: 15000 });
        await settled(page, 'input[placeholder="Table name"]');
        await waitFor(async () => (await formulaCell(1).innerText()).trim() === '100', 'y after a reload', 15000);
        eq((await formulaCell(0).innerText()).trim(), '10', 'x after a reload');
        eq(await page.locator('table tbody tr').nth(1).locator('[data-own-formula]').count(), 1, 'y is marked');
        eq(await page.locator('table tbody tr').nth(0).locator('[data-own-formula]').count(), 0, 'x is not marked');
        const saved = await api.get('table_rows', rowY.id, me.token);
        eq(saved.data?.cells?.cd__fx, '[A] * 100', 'the override is stored with the row');
        const other = await api.get('table_rows', rowX.id, me.token);
        ok(!other.data?.cells?.cd__fx, 'x has no override stored');
      });

    await check('the cell can go back to the column formula',
      'An exception has to be removable without knowing where it is stored.',
      async () => {
        await formulaCell(1).click();
        await page.getByRole('button', { name: "Use the column's formula again" }).click();
        await waitFor(async () => (await formulaCell(1).innerText()).trim() === '2', 'y back on the column formula');
        eq(await page.locator('[data-own-formula]').count(), 0, 'no cells marked');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused save is invisible in the grid and lost on reload.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
