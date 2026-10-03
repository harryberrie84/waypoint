import { startApp, registerInUi, pickStarter, waitFor, settled } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const menu = (page, text) => page.locator('div[style*="z-index: 1300"] button').filter({ hasText: text }).first();

async function insert(page, line, query, text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = page.locator('.ProseMirror[contenteditable="true"] > p', { hasText: line }).first();
    await target.click();
    await page.waitForTimeout(150);
    const inLine = await page.evaluate((line) => (window.getSelection()?.anchorNode?.textContent || '').includes(line), line);
    if (!inLine) continue;
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(query);
    try {
      await menu(page, text).click({ timeout: 5000 });
      return;
    } catch {
      await page.keyboard.press('Escape');
      await page.keyboard.type(line);
    }
  }
  throw new Error(`could not open the menu on the line "${line}"`);
}

export default async function () {
  suite('browser: widgets over tables');
  const app = await startApp();
  const url = app.pb.url;
  try {
    const page = await app.newPage('owner');
    await registerInUi(page, url, 'widgets');
    await pickStarter(page, 'blank page');
    await page.locator('main input').first().fill('Trip');
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type('packing goes here');
    await page.keyboard.press('Enter');
    await page.keyboard.type('budget goes here');
    await page.keyboard.press('Enter');
    await page.keyboard.type('table goes here');
    await insert(page, 'packing goes here', '/packing', 'Packing list');
    const packing = page.locator('[data-table-widget="packing"]');

    await check('a packing list opens as a checklist, not a spreadsheet',
      'Most people never need the table behind a packing list; a grid with field headers is the thing that made pages look like a database dump.',
      async () => {
        await packing.waitFor({ timeout: 15000 });
        eq(await packing.locator('table').count(), 0, 'grid cells inside the packing widget');
        ok((await packing.innerText()).includes('Packing'), 'the widget is titled');
      });

    await check('items added and ticked in the widget are still there after a reload',
      'The widget writes the same rows as the table. A tick that does not survive a reload is a lost item at the airport.',
      async () => {
        await packing.locator('input[placeholder^="Name this"]').first().fill('Passport');
        await packing.getByRole('button', { name: 'Add an item' }).click();
        await waitFor(async () => (await packing.locator('input[placeholder^="Name this"]').count()) === 2, 'a second item');
        await packing.locator('input[placeholder^="Name this"]').last().fill('Charger');
        await packing.getByRole('button', { name: 'Tick Passport' }).click();
        await page.waitForTimeout(2500);
        await page.reload();
        await packing.waitFor({ timeout: 15000 });
        await settled(page, '[data-table-widget="packing"]');
        await waitFor(async () => {
          const names = await packing.locator('input[placeholder^="Name this"]').evaluateAll((els) => els.map((e) => e.value));
          return names.includes('Passport') && names.includes('Charger') && (await packing.getByRole('button', { name: 'Untick Passport' }).count()) === 1;
        }, 'both items and the tick after a reload', 15000);
        ok((await packing.innerText()).includes('1/2 packed'), 'the count reads 1/2 packed');
      });

    await check('typing into a new item before the server has made it is not lost',
      'On a slow connection the name typed into a just-added item was saved against a temporary id, refused, and gone after a reload.',
      async () => {
        await page.route('**/api/collections/table_rows/records', async (route) => {
          if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1500));
          await route.continue();
        });
        await packing.getByRole('button', { name: 'Add an item' }).click();
        await waitFor(async () => (await packing.locator('input[placeholder^="Name this"]').count()) === 3, 'a third item');
        const fresh = await packing.locator('input[placeholder^="Name this"]:placeholder-shown').first().elementHandle();
        await fresh.click();
        await page.keyboard.type('Adapter');
        await page.waitForTimeout(2500);
        await page.keyboard.type(' plug');
        const where = await fresh.evaluate((el) => ({ connected: el.isConnected, active: document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('placeholder') || document.activeElement?.className?.slice?.(0, 40)), value: el.value }));
        ok(await fresh.evaluate((el) => el === document.activeElement), `the field kept focus when the server made the row (${JSON.stringify(where)})`);
        await page.unroute('**/api/collections/table_rows/records');
        await page.waitForTimeout(2500);
        await page.reload();
        await packing.waitFor({ timeout: 15000 });
        await waitFor(async () => (await packing.locator('input[placeholder^="Name this"]').evaluateAll((els) => els.map((e) => e.value))).includes('Adapter plug'), 'the typed name after a reload', 15000);
      });

    await check('removing an item by mistake can be undone, and the undo survives a reload',
      'On a phone the remove button sits next to the item; one stray tap must not cost the item or its tick.',
      async () => {
        await packing.getByRole('button', { name: 'Remove Passport' }).click();
        await waitFor(async () => (await packing.getByRole('button', { name: 'Untick Passport' }).count()) === 0, 'Passport gone');
        await page.getByRole('button', { name: 'Undo' }).click();
        await waitFor(async () => (await packing.getByRole('button', { name: 'Untick Passport' }).count()) === 1, 'Passport back, still ticked');
        await page.waitForTimeout(2500);
        await page.reload();
        await packing.waitFor({ timeout: 15000 });
        await waitFor(async () => (await packing.getByRole('button', { name: 'Untick Passport' }).count()) === 1, 'Passport, ticked, after a reload', 15000);
      });

    await check('the table is one click away and shows the same rows, and folds back',
      'Filters, fields and formulas live in the table; hiding it must not lock anyone out of it.',
      async () => {
        await packing.getByRole('button', { name: 'Show as a table' }).click();
        const grid = page.locator('input[placeholder="Table name"]').first();
        await grid.waitFor({ timeout: 10000 });
        eq(await grid.inputValue(), 'Packing', 'the table behind the widget');
        const cells = await page.locator('table tbody input:not([type=checkbox])').evaluateAll((els) => els.map((e) => e.value));
        ok(cells.includes('Passport') && cells.includes('Charger'), `the grid shows the widget's rows, got ${JSON.stringify(cells)}`);
        await page.reload();
        await page.locator('input[placeholder="Table name"]').first().waitFor({ timeout: 15000 });
        await settled(page, 'input[placeholder="Table name"]');
        await page.getByRole('button', { name: 'Show as a widget' }).first().click();
        await packing.waitFor({ timeout: 10000 });
        await page.reload();
        await packing.waitFor({ timeout: 15000 });
        eq(await page.locator('input[placeholder="Table name"]').count(), 0, 'the table stayed folded after a reload');
        await settled(page, '.ProseMirror[contenteditable="true"]');
      });

    await check('Budget adds both the expenses and the settle-up block, where the command was typed',
      'Inserting a budget used to drop the expenses table, and a widget that took a moment to create landed wherever the cursor had moved in the meantime, splitting someone else’s sentence.',
      async () => {
        await page.route('**/api/collections/tables/records', async (route) => {
          if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 2000));
          await route.continue();
        });
        await insert(page, 'budget goes here', '/budget', 'Expenses, split');
        const other = page.locator('.ProseMirror[contenteditable="true"] > p', { hasText: 'table goes here' }).first();
        await other.click();
        await page.keyboard.press('End');
        await page.keyboard.type(' soon');
        await page.locator('[data-table-widget="budget"]').waitFor({ timeout: 15000 });
        await page.unroute('**/api/collections/tables/records');
        await page.getByText('Settle up', { exact: true }).waitFor({ timeout: 10000 });
        const order = await page.evaluate(() => [...document.querySelector('.ProseMirror[contenteditable="true"]').children].map((el) => el.getAttribute('data-table-widget') || (el.querySelector('[data-table-widget]')?.getAttribute('data-table-widget')) || (/Settle up/.test(el.textContent || '') ? 'settle' : '') || (el.tagName === 'P' ? `p:${el.textContent}` : el.tagName)));
        const budgetAt = order.findIndex((x) => x === 'budget');
        const lineAt = order.findIndex((x) => x === 'p:table goes here soon');
        ok(budgetAt >= 0 && lineAt > budgetAt, `the budget should sit above the line that was typed into meanwhile, got ${JSON.stringify(order)}`);
        eq(order[budgetAt + 1], 'settle', 'settle-up follows the expenses');
        await insert(page, 'table goes here soon', '/table', 'Relational database');
      });

    await check('a table inserted as a table stays a table',
      'Someone who asked for a database wants the grid, not a list.',
      async () => {
        await waitFor(async () => (await page.locator('.tiptap table').count()) > 0, 'a grid');
        eq(await page.locator('[data-table-widget]').count(), 2, 'widgets on the page (packing and budget only)');
      });

    await check('widgets fit a phone screen without sideways scrolling',
      'Packing and groceries are used on a phone in a shop or an airport.',
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(400);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        ok(over <= 0, `the page scrolls sideways by ${over}px`);
        const box = await packing.boundingBox();
        ok(box && box.x >= 0 && box.x + box.width <= 390, 'the packing widget is inside the screen');
        await page.setViewportSize({ width: 1400, height: 900 });
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused save is invisible in the widget and lost on reload.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
