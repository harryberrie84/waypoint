import { startApp, registerInUi, pickStarter, waitFor } from '../harness/browser.mjs';
import { suite, check, eq } from '../harness/runner.mjs';

export default async function () {
  suite('browser: the / menu');
  const app = await startApp();
  const url = app.pb.url;
  try {
    const page = await app.newPage('writer');
    await registerInUi(page, url, 'writer');
    await pickStarter(page, 'blank page');
    const ed = page.locator('.ProseMirror').first();
    const menu = async () => {
      if (await page.getByText('No matching blocks').count()) return 'empty menu';
      const n = await page.locator('div[style*="z-index: 1300"] button').count();
      return n ? 'menu' : 'closed';
    };
    const opens = (what) => waitFor(async () => (await menu()) === 'menu', `the menu for ${what}`, 3000);
    const fresh = async () => {
      await page.keyboard.press('Escape');
      await ed.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
    };

    await check('a / inside ordinary writing does not open the menu',
      'People write "yes / no" and "1/2" all day; a menu that follows the rest of the line saying "No matching blocks" gets in the way of every sentence.',
      async () => {
        await fresh();
        await page.keyboard.type('yes / no, maybe later');
        await page.waitForTimeout(250);
        eq(await menu(), 'closed', 'menu after prose');
      });

    await check('Enter makes a new line when the menu has nothing to pick',
      'Swallowing Enter left people stuck on a line they could not leave.',
      async () => {
        await fresh();
        await page.keyboard.type('/zzz');
        await page.waitForTimeout(200);
        const lines = await ed.locator('p').count();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(250);
        eq((await ed.locator('p').count()) > lines, true, 'a new line was made');
        eq(await menu(), 'closed', 'menu after Enter');
      });

    await check('the menu opens on /, closes on Escape, and stays closed while you keep writing',
      'Escape is the universal "not now"; the menu coming back after it is the complaint that started this.',
      async () => {
        await fresh();
        await page.keyboard.type('/');
        await opens('/');
        await page.keyboard.press('Escape');
        await page.keyboard.type(' and then more words');
        await page.waitForTimeout(250);
        eq(await menu(), 'closed', 'menu after Escape and more writing');
      });

    await check('clicking anywhere else closes the menu',
      'A menu that survives a click elsewhere floats over whatever the person moved on to.',
      async () => {
        await fresh();
        await page.keyboard.type('/tab');
        await opens('/tab');
        await page.mouse.click(700, 60);
        await page.waitForTimeout(300);
        eq(await menu(), 'closed', 'menu after a click elsewhere');
      });

    await check('commands that take words still accept spaces after the colon',
      '/date:next friday and /convert:100 usd to eur are written as phrases; the fix for prose must not break them.',
      async () => {
        await fresh();
        await page.keyboard.type('/date:next friday');
        await opens('/date:next friday');
        await fresh();
        await page.keyboard.type('/convert:100 usd to eur');
        await opens('/convert:100 usd to eur');
      });

    await check('picking a command with Enter still inserts it',
      'The menu exists to insert blocks.',
      async () => {
        await fresh();
        const before = await ed.locator('hr').count();
        await page.keyboard.type('/divider');
        await opens('/divider');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        eq(await ed.locator('hr').count(), before + 1, 'dividers');
      });

    await check('nothing along the way was refused by the server',
      'A refused save is invisible in the UI and lost on reload.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
