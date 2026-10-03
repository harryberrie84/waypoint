import { startApp, signInInUi, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: the trash only ever removes what was put in it');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const me = await api.signup('me');
    const ws = await api.workspace(me);
    const mk = (title, parent, extra = {}) => api.must(api.create('pages', { title, parent, workspace: ws.id, owner: me.id, order: 0, ...extra }, me.token), title);
    const top = await mk('Top', '');
    const plan = await mk('Old plan', top.id);
    const went = await mk('Went with it', plan.id);
    const alone = await mk('Binned on its own', plan.id, { trashed: true, trashedWith: '' });
    await api.must(api.update('pages', alone.id, { trashedWith: alone.id }, me.token), 'alone');
    for (const p of [plan, went]) await api.must(api.update('pages', p.id, { trashed: true, trashedWith: plan.id }, me.token), 'trash');
    const live = await mk('Made later by a teammate', plan.id);
    const box = await mk('Box', '', { trashed: true, trashedWith: '' });
    await api.must(api.update('pages', box.id, { trashedWith: box.id }, me.token), 'box');
    const loose = await mk('Thrown out first', box.id, { trashed: true });
    await api.must(api.update('pages', loose.id, { trashedWith: loose.id }, me.token), 'loose');

    const page = await app.newPage('me');
    await signInInUi(page, url, me.email);
    await page.getByTitle('Sign out').waitFor();
    const onServer = async (id) => { const r = await api.get('pages', id, me.token); return r.status === 200 ? r.data : null; };
    const panel = () => page.getByRole('dialog', { name: 'Trash' });
    const rowFor = (title) => page.locator('div.flex.items-center', { hasText: title }).filter({ has: page.getByTitle('Restore') }).last();

    await check('restoring a page leaves a sub-page that was thrown out on its own in the trash',
      'Restoring a parent used to bring back every sub-page under it, including ones deliberately binned earlier.',
      async () => {
        await page.getByTitle('Trash', { exact: true }).click();
        await rowFor('Box').getByTitle('Restore').click();
        await waitFor(async () => (await onServer(box.id))?.trashed === false, 'Box restored on the server');
        await page.waitForTimeout(500);
        eq((await onServer(loose.id))?.trashed, true, 'the sub-page binned on its own is still in the trash');
        await page.keyboard.press('Escape');
      });

    await check('deleting a trashed page for good keeps live pages under it and ones binned on their own',
      'Clearing the trash, by hand or after 14 days, followed every sub-page and deleted live ones a teammate had added under the trashed page.',
      async () => {
        await page.getByTitle('Trash', { exact: true }).click();
        const row = rowFor('Old plan');
        await row.getByTitle('Delete forever').click();
        await page.getByRole('button', { name: 'yes', exact: true }).click();
        await waitFor(async () => !(await onServer(plan.id)), 'the trashed page gone from the server');
        ok(!(await onServer(went.id)), 'the sub-page trashed with it is gone too');
        const l = await onServer(live.id);
        ok(l, 'the live sub-page was deleted');
        eq(l.trashed, false, 'the live sub-page is not in the trash');
        eq(l.parent, top.id, 'the live sub-page moved up to the page above');
        const a = await onServer(alone.id);
        ok(a && a.trashed, 'the sub-page binned on its own is still in the trash');
        eq(a.parent, top.id, 'and points at a page that exists');
        await waitFor(async () => (await panel().innerText()).includes('Binned on its own'), 'it listed in the trash on its own');
      });

    await check('Clear trash empties the trash and nothing else',
      'The one-click empty must never reach a page that is not in the trash.',
      async () => {
        await page.getByText('Clear trash').click();
        await page.getByRole('button', { name: 'yes, empty' }).click();
        await waitFor(async () => !(await onServer(alone.id)) && !(await onServer(loose.id)), 'the trash emptied on the server');
        for (const p of [top, live, box]) ok(await onServer(p.id), `${p.title} was deleted by Clear trash`);
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused move or delete here would leave pages half deleted.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
