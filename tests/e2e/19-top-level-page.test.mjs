import { startApp, signInInUi, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: "New top-level page" makes a top-level page');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const me = await api.signup('me');
    const ws = await api.workspace(me);
    const first = await api.must(api.create('pages', { title: 'Alpha', workspace: ws.id, owner: me.id, parent: '', order: 0 }, me.token), 'alpha');
    await api.must(api.create('pages', { title: 'Beta', workspace: ws.id, owner: me.id, parent: '', order: 1 }, me.token), 'beta');
    const other = await api.workspace(me, 'Elsewhere');
    await api.must(api.create('pages', { title: 'Far', workspace: other.id, owner: me.id, parent: '', order: 0 }, me.token), 'far');

    const page = await app.newPage('me');
    await signInInUi(page, url, me.email);
    await sidebar(page).getByText('Alpha', { exact: true }).first().waitFor();
    const mine = async () => (await api.list('pages', me.token)).filter((p) => p.workspace === ws.id);

    await check('the + next to Pages creates a page at the top, not inside the first page',
      'It made the new page a sub-page of whichever page sorted first, so it appeared hidden under that page.',
      async () => {
        const before = (await mine()).length;
        await page.getByTitle('New top-level page').click();
        await waitFor(async () => (await mine()).length === before + 1, 'the new page on the server');
        const made = (await mine()).find((p) => p.title === 'Untitled');
        ok(made, 'no Untitled page');
        eq(made.parent, '', 'parent of the new page');
        ok(made.parent !== first.id, 'it went under Alpha');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused create would leave the click doing nothing.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
