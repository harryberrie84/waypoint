import { startApp, registerInUi, pickStarter, waitFor, settled } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';
import { client } from '../harness/api.mjs';

const headers = (page) => page.locator('table thead th input').evaluateAll((els) => els.map((e) => e.value));
const amountInput = (page) => page.locator('table tbody tr').first().locator('input[inputmode=decimal]');

export default async function () {
  suite('browser: deleting a table column');
  const app = await startApp();
  const api = client(app.pb.url);
  try {
    const page = await app.newPage('owner');
    const who = await registerInUi(page, app.pb.url, 'columns');
    await pickStarter(page, 'blank page');
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type('/table');
    await page.locator('div[style*="z-index: 1300"] button', { hasText: 'Relational database' }).click();
    await page.getByText('New row').first().waitFor();
    const first = page.locator('table tbody tr').first().locator('input').first();
    await first.click();
    await first.fill('Ferry tickets');
    await amountInput(page).fill('450');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(2500);

    const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: who.email, password: who.password }), 'token');
    const [table] = await api.list('tables', auth.token);
    const amount = table.columns.find((c) => c.type === 'number');
    ok(amount, 'the table has a number column');
    const openMenu = async () => {
      const th = page.locator('table thead th').filter({ has: page.locator(`input[value="${amount.name}"]`) }).first();
      await th.locator('button').last().click();
      await page.getByRole('button', { name: 'Delete column' }).first().click();
    };

    await check('deleting a column asks first and says how many rows hold values in it',
      'One click on the menu used to take the column and every value in it, with no question asked.',
      async () => {
        await openMenu();
        await page.getByText('1 row has a value in it.', { exact: false }).waitFor({ timeout: 5000 });
        await page.getByRole('button', { name: 'Cancel' }).click();
        ok((await headers(page)).includes(amount.name), 'cancel keeps the column');
        eq(await amountInput(page).inputValue(), '450', 'and its value');
      });

    await check('a deleted column keeps its values on the rows, and undo brings it back whole',
      'The values were stripped from every row on the server in the same click, so nothing could bring them back.',
      async () => {
        await openMenu();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Delete column' }).click();
        await waitFor(async () => !(await headers(page)).includes(amount.name), 'the column gone from the table');
        await page.waitForTimeout(2500);
        const [saved] = await api.list('tables', auth.token);
        ok(!saved.columns.some((c) => c.id === amount.id), 'the server no longer lists the column');
        const [row] = await api.list('table_rows', auth.token, `&filter=${encodeURIComponent(`table="${table.id}"`)}`);
        eq(row.cells[amount.id], 450, 'the value is still on the row on the server');

        await page.getByRole('button', { name: /Undo/ }).first().click();
        await waitFor(async () => (await headers(page)).includes(amount.name), 'the column back');
        eq(await amountInput(page).inputValue(), '450', 'with its value');
        await page.waitForTimeout(2500);
        await page.reload();
        await page.getByText('New row').first().waitFor({ timeout: 15000 });
        await settled(page, 'table thead th input');
        await waitFor(async () => (await headers(page)).includes(amount.name), 'the column after a reload', 15000);
        eq(await amountInput(page).inputValue(), '450', 'and its value after a reload');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused save here is a column that comes back on one device and not another.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
