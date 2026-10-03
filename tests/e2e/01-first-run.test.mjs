import { startApp, registerInUi, signInInUi, pickStarter, sidebar, sidebarText, waitFor, editorText } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: first run, writing, and what survives a reload');
  const app = await startApp();
  const url = app.pb.url;
  try {
    const page = await app.newPage('first user');
    let account;

    await check('a new account lands on the starter picker and can start a page from it',
      'It is the first thing anyone sees. If sign-up, the first workspace or the starter fails, the app looks broken on day one.',
      async () => {
        account = await registerInUi(page, url, 'first');
        await page.getByText('start with something').waitFor({ timeout: 10000 });
        await pickStarter(page, 'a trip');
        await waitFor(async () => (await sidebarText(page)).includes('Trip'), 'Trip in the sidebar');
        eq(app.problems, [], 'failed requests or page errors');
      });

    const words = `Ferry at nine ${Date.now()}`;
    await check('what you type is still there after a reload',
      'Losing typed text is the worst thing a notes app can do; the page body goes through Yjs, its relay and its snapshot, and each of those has lost text before.',
      async () => {
        await page.locator('.ProseMirror').first().click();
        await page.keyboard.press('Control+End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(words);
        await page.waitForTimeout(5000);
        await page.reload();
        await page.locator('.ProseMirror').first().waitFor();
        await waitFor(async () => (await editorText(page)).includes(words), 'the typed words after reload', 15000);
      });

    await check('the same page opened on another device shows the same text',
      'The page list no longer carries the Yjs snapshot, so the editor must still fetch it on its own when a page opens.',
      async () => {
        const other = await app.newPage('second device');
        await signInInUi(other, url, account.email);
        await sidebar(other).getByText('Trip', { exact: true }).first().click();
        await waitFor(async () => (await editorText(other)).includes(words), 'the text on the second device', 15000);
      });

    await check('a trashed page stays in the trash after a reload, and comes back when restored',
      'Trash used to undo itself on reload because the field was never stored; people then trash a page, see it return, and stop trusting deletes.',
      async () => {
        const row = sidebar(page).getByText('Trip', { exact: true }).first();
        await row.hover();
        await sidebar(page).getByTitle('Move to trash').first().click();
        await waitFor(async () => !(await sidebarText(page)).includes('Trip'), 'Trip leaving the sidebar');
        await page.reload();
        await page.getByTitle('Sign out').waitFor();
        await page.waitForTimeout(1500);
        ok(!(await sidebarText(page)).includes('Trip'), 'Trip is back in the sidebar after a reload');
        await page.getByTitle('Trash').first().click();
        await page.getByTitle('Restore').first().click();
        await page.keyboard.press('Escape');
        await waitFor(async () => (await sidebarText(page)).includes('Trip'), 'Trip back after restore');
        await page.reload();
        await page.getByTitle('Sign out').waitFor();
        await waitFor(async () => (await sidebarText(page)).includes('Trip'), 'Trip still back after a reload');
      });

    await check('a new sub-page and a rename show in the sidebar at once',
      'The sidebar rows now redraw only when their own data changes; they must still redraw when it does.',
      async () => {
        await sidebar(page).getByText('Trip', { exact: true }).first().hover();
        await sidebar(page).getByTitle('Add sub-page').first().click();
        await waitFor(async () => (await sidebarText(page)).includes('Untitled'), 'the new sub-page');
        const title = page.locator('main input').first();
        await title.click();
        await title.fill('Ferry day');
        await waitFor(async () => (await sidebarText(page)).includes('Ferry day'), 'the renamed sub-page');
      });

    await check('nothing the app did along the way was refused by the server',
      'A refused save is invisible in the UI and lost on reload; every one of them is a bug.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
