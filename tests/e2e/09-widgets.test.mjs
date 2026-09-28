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

    await check('Budget adds both the expenses and the settle-up block',
      'Inserting a budget used to drop the expenses table and keep only the settle-up block, so the page had nowhere to enter a cost.',
      async () => {
        await insert(page, 'budget goes here', '/budget', 'Expenses, split');
        await page.locator('[data-table-widget="budget"]').waitFor({ timeout: 15000 });
        await page.getByText('Settle up', { exact: true }).waitFor({ timeout: 10000 });
      });

    await check('a table inserted as a table stays a table',
      'Someone who asked for a database wants the grid, not a list.',
      async () => {
        await insert(page, 'table goes here', '/table', 'Relational database');
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
