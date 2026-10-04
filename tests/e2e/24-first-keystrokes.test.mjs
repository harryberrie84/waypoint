import { startApp, registerInUi, pickStarter, waitFor } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const slowRelay = async (page, ms) => {
  await page.route('**/api/collections/yupdates/records**', async (route) => {
    if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, ms));
    await route.continue().catch(() => {});
  });
};

const editorText = (page) => page.evaluate(() => document.querySelector('.ProseMirror')?.editor?.getText() ?? '');

export default async function () {
  suite('browser: the first keystrokes on a page that just opened');
  const app = await startApp();
  try {
    await check('typing fast on a fresh page does not stop it with an error',
      'Every keystroke re-ran a decrypt effect that reset state on plaintext pages. Fast typing chained those renders until React gave up with "too many nested updates" and the page went blank.',
      async () => {
        for (let run = 0; run < 4; run++) {
          const page = await app.newPage(`fast${run}`);
          const errors = [];
          page.on('pageerror', (e) => errors.push(e.message));
          await registerInUi(page, app.pb.url, `fast${run}`);
          await pickStarter(page, 'blank page');
          // Straight in, the way a person starts writing on a page they just made.
          await page.locator('.ProseMirror').first().click();
          for (let i = 0; i < 20; i++) {
            await page.keyboard.type('Line ' + i);
            await page.keyboard.press('Enter');
          }
          await page.waitForTimeout(1500);
          eq(errors, [], `page errors on run ${run + 1}`);
          // Every character, in order: a dropped letter is lost work too.
          const want = Array.from({ length: 20 }, (_, i) => 'Line ' + i).join('\n\n');
          eq((await editorText(page)).trim(), want, `the typed text on run ${run + 1}`);
          await page.context().close();
        }
      });

    await check('a click and keys made while the page is still connecting land in the page',
      'The page shows a read-only preview while it joins the live session. A click there took no caret, and the live editor that replaced it had no focus, so everything typed went nowhere.',
      async () => {
        const page = await app.newPage('early');
        await registerInUi(page, app.pb.url, 'early');
        await slowRelay(page, 2500);
        await pickStarter(page, 'blank page');
        const preview = page.locator('.ProseMirror[contenteditable="false"]');
        await preview.waitFor({ timeout: 15000 });
        await preview.click();
        await page.keyboard.type('Typed before it was ready', { delay: 30 });
        await page.keyboard.press('Enter');
        await page.keyboard.type('and a second line', { delay: 30 });
        await waitFor(async () => (await editorText(page)).includes('and a second line'), 'the held keys in the live editor', 15000);
        ok((await editorText(page)).includes('Typed before it was ready'), 'the first line too');
        await page.keyboard.type(' then more');
        await waitFor(async () => (await editorText(page)).includes('and a second line then more'), 'typing carries on at the caret');
        await page.unroute('**/api/collections/yupdates/records**');
        await page.waitForTimeout(2500);
        await page.reload();
        await waitFor(async () => (await editorText(page)).includes('Typed before it was ready'), 'the early typing after a reload', 20000);
      });

    await check('nothing along the way was refused by the server or crashed',
      'A crash on the first page is the first thing a new account sees.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
