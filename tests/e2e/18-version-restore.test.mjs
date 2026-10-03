import { startApp, signInInUi, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

export default async function () {
  suite('browser: restoring a version can itself be undone');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const me = await api.signup('me');
    const ws = await api.workspace(me);
    const pg = await api.must(api.create('pages', { title: 'Notes', workspace: ws.id, owner: me.id, parent: '', content: doc('Current words') }, me.token), 'page');
    await api.must(api.create('page_versions', { page: pg.id, workspace: ws.id, content: JSON.stringify(doc('Old words')) }, me.token), 'old version');

    const page = await app.newPage('me');
    await signInInUi(page, url, me.email);
    await sidebar(page).getByText('Notes', { exact: true }).first().click();
    const body = () => page.locator('.ProseMirror').first().innerText();
    await waitFor(async () => (await body()).includes('Current words'), 'the current text');
    const versions = async () => (await api.list('page_versions', me.token)).filter((v) => v.page === pg.id);
    const openHistory = async () => {
      await page.getByTitle('More', { exact: true }).click();
      await page.getByText('Version history').first().click();
    };

    await check('restoring an old version first saves the text it replaces',
      'Backups are throttled to one per four minutes, so restoring replaced recent text that had no backup at all, with no way back.',
      async () => {
        await page.locator('.ProseMirror[contenteditable="true"]').first().click();
        await page.keyboard.press('Control+End');
        await page.keyboard.type(' and a fresh line');
        await page.waitForTimeout(1500);
        const before = (await versions()).length;
        await openHistory();
        await page.getByRole('button', { name: 'Restore' }).last().click();
        await page.getByRole('button', { name: 'restore this' }).click();
        await waitFor(async () => (await body()).includes('Old words'), 'the old text in the editor');
        await waitFor(async () => (await versions()).length > before, 'a version saved by the restore');
        ok((await versions()).some((v) => String(v.content).includes('a fresh line')), 'the text typed since the last backup was not saved before the restore');
      });

    await check('restoring that saved copy brings the replaced text back',
      'The point of saving it is that a wrong restore can be walked back.',
      async () => {
        await openHistory();
        await page.getByRole('button', { name: 'Restore' }).first().click();
        await page.getByRole('button', { name: 'restore this' }).click();
        await waitFor(async () => (await body()).includes('a fresh line'), 'the replaced text back');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused backup must stop the restore, never pass silently.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
