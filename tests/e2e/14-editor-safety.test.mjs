import { startApp, registerInUi, pickStarter, waitFor } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const menu = (page, text) => page.locator('div[style*="z-index: 1300"] button').filter({ hasText: text }).first();
const blocks = (page) =>
  page.evaluate(() => [...document.querySelector('.ProseMirror[contenteditable="true"]').children].map((el) => (el.tagName === 'P' ? `p:${el.textContent}` : el.getAttribute('data-table-widget') ? 'widget' : el.className.includes('node-') ? el.className.match(/node-(\w+)/)[1] : el.tagName)));

export default async function () {
  suite('browser: the editor never drops a block or a keystroke by accident');
  const app = await startApp();
  try {
    const page = await app.newPage('writer');
    await registerInUi(page, app.pb.url, 'writer');
    await pickStarter(page, 'blank page');
    await page.locator('main input').first().fill('Safety');
    const ed = page.locator('.ProseMirror[contenteditable="true"]').first();
    await ed.click();
    await page.keyboard.type('Before');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/table');
    await menu(page, 'Relational database').click();
    await waitFor(async () => (await page.locator('.tiptap table').count()) > 0, 'the table');

    await check('Backspace at the start of the line below a table selects it first instead of deleting it',
      'One Backspace at the start of a line under a widget merged the lines and deleted the widget, its table included, without asking.',
      async () => {
        await page.locator('.ProseMirror[contenteditable="true"] > p').last().click();
        await page.keyboard.type('After');
        await page.keyboard.press('Home');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(400);
        ok((await page.locator('.tiptap table').count()) > 0, 'the table was deleted by one Backspace');
        ok((await blocks(page)).includes('p:After'), 'the line below was merged away');
        await page.keyboard.press('Backspace');
        await page.getByRole('button', { name: 'Cancel' }).waitFor({ timeout: 5000 });
        await page.getByRole('button', { name: 'Cancel' }).click();
        ok((await page.locator('.tiptap table').count()) > 0, 'cancelling the confirm still deleted the table');
      });

    await check('typing straight after inserting a block goes on a new line below it',
      'After inserting most blocks the next keystrokes were thrown away with a "block is selected" message.',
      async () => {
        await page.locator('.ProseMirror[contenteditable="true"] > p', { hasText: 'After' }).click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('/countdown');
        await menu(page, 'Days until a date').click();
        await page.waitForTimeout(600);
        await page.locator('.ProseMirror[contenteditable="true"]').first().focus();
        await page.keyboard.type('kept');
        await waitFor(async () => (await blocks(page)).includes('p:kept'), 'the typed word on its own line');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A crash or refused save in the editor is invisible and loses work.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
