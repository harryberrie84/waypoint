import { startApp, registerInUi, pickStarter, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const menu = (page, text) => page.locator('div[style*="z-index: 1300"] button').filter({ hasText: text }).first();
const editorText = (page) => page.evaluate(() => document.querySelector('.ProseMirror')?.editor?.getText() ?? '');
const blocks = (page) => page.evaluate(() => document.querySelector('.ProseMirror').editor.getJSON().content.map((n) => n.type));

export default async function () {
  suite('browser: undo and redo');
  const app = await startApp();
  const api = client(app.pb.url);
  try {
    const page = await app.newPage('undo');
    const me = await registerInUi(page, app.pb.url, 'undo');
    await pickStarter(page, 'blank page');
    await page.locator('.ProseMirror[contenteditable="true"]').waitFor({ timeout: 15000 });
    const k = page.keyboard;

    await check('undoing everything and redoing it gives back exactly the text, with the caret after it',
      'Redo brought the text back under a blank line with the caret in that line, so the next words went above the text instead of after it.',
      async () => {
        await page.locator('.ProseMirror').first().click();
        await k.type('First sentence here.', { delay: 30 });
        await page.waitForTimeout(800);
        await k.type(' Second sentence.', { delay: 30 });
        await page.waitForTimeout(800);
        await k.press('Control+z');
        await k.press('Control+z');
        eq((await editorText(page)).trim(), '', 'two undos empty the page');
        await k.press('Control+Shift+z');
        await k.press('Control+Shift+z');
        eq(await editorText(page), 'First sentence here. Second sentence.', 'two redos bring all of it back');
        eq(await blocks(page), ['paragraph'], 'and no blank line above it');
        await k.type(' Third.');
        eq(await editorText(page), 'First sentence here. Second sentence. Third.', 'typing carries on after the text');
      });

    await check('undoing a poll off the page keeps its options and votes, and redo brings them back',
      'A poll keeps its options and votes in their own records. Undo only takes the block off the page, and those records must still be there when redo puts it back.',
      async () => {
        await k.press('Enter');
        await k.type('/poll');
        await menu(page, 'Poll').click({ timeout: 5000 });
        const add = page.locator('input[placeholder="add an option…"]');
        await add.waitFor({ timeout: 10000 });
        await add.fill('Tokyo');
        await add.press('Enter');
        await add.fill('Osaka');
        await add.press('Enter');
        await page.locator('[title="vote"]').first().click();
        await waitFor(async () => (await page.locator('[title="remove your vote"]').count()) === 1, 'my vote');
        await page.waitForTimeout(1500);

        const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: me.email, password: me.password }), 'sign in');
        const tableId = await page.evaluate(() => document.querySelector('.ProseMirror').editor.getJSON().content.find((n) => n.type === 'pollBlock')?.attrs?.tableId);
        ok(tableId, 'the poll is bound to a table');

        await page.locator('.ProseMirror > p').last().click();
        await k.press('End');
        await k.type('after the poll', { delay: 20 });
        await page.waitForTimeout(800);
        for (let i = 0; i < 3 && (await blocks(page)).includes('pollBlock'); i++) {
          await k.press('Control+z');
          await page.waitForTimeout(400);
        }
        ok(!(await blocks(page)).includes('pollBlock'), 'undo took the poll off the page');
        await page.waitForTimeout(2500);

        const rows = await api.list('table_rows', auth.token, `&filter=${encodeURIComponent(`table="${tableId}"`)}`);
        eq(rows.length, 2, 'both options are still on the server');
        const votes = rows.reduce((n, r) => n + (r.reactions?.['👍']?.length ?? 0), 0);
        eq(votes, 1, 'and so is the vote');

        for (let i = 0; i < 3 && !(await blocks(page)).includes('pollBlock'); i++) {
          await k.press('Control+Shift+z');
          await page.waitForTimeout(400);
        }
        ok((await blocks(page)).includes('pollBlock'), 'redo put the poll back');
        await waitFor(async () => (await page.locator('[title="remove your vote"]').count()) === 1, 'the vote, shown again');
        ok((await page.locator('.ProseMirror').innerText()).includes('Osaka'), 'and the options');
      });

    await check('nothing along the way was refused by the server or crashed',
      'An error mid-undo leaves a page nobody trusts.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
