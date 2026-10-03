import { startApp, signInInUi, sidebar, waitFor, settled } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: deleting a row with sub-rows');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const me = await api.signup('me');
    const ws = await api.workspace(me);
    const columns = [{ id: 'cname', name: 'Name', type: 'text', width: 200 }];
    const table = await api.must(api.create('tables', { name: 'Tasks', columns, workspace: ws.id, views: { id: 'default', name: 'Grid', type: 'grid', filters: [], sorts: [] } }, me.token), 'table');
    const row = (cells, parent, position) => api.must(api.create('table_rows', { table: table.id, cells, parent, position, workspace: ws.id }, me.token), 'row');
    const trip = await row({ cname: 'Trip' }, '', 0);
    const flights = await row({ cname: 'Flights' }, trip.id, 1);
    const seats = await row({ cname: 'Seats' }, flights.id, 2);
    const other = await row({ cname: 'Other' }, '', 3);
    const content = { type: 'doc', content: [{ type: 'tableEmbed', attrs: { tableId: table.id } }] };
    const pg = await api.must(api.create('pages', { title: 'Plan', workspace: ws.id, owner: me.id, order: 0, parent: '', content }, me.token), 'page');
    const note = await api.must(api.create('comments', { page: pg.id, row: flights.id, author: me.id, authorName: me.name, body: 'window seats', mentions: [] }, me.token), 'comment');

    const page = await app.newPage('me');
    await signInInUi(page, url, me.email);
    await sidebar(page).getByText('Plan', { exact: true }).first().click();
    await page.locator('table tbody tr').nth(3).waitFor({ timeout: 15000 });
    await settled(page, 'input[placeholder="Table name"]');
    const serverRows = async () => (await api.list('table_rows', me.token)).filter((r) => r.table === table.id);

    await check('deleting a row takes its sub-rows with it',
      'Sub-rows used to stay behind, pointing at a row that no longer exists, and popped up at the top of the table as if they were new.',
      async () => {
        const tripRow = page.locator('table tbody tr').filter({ has: page.locator('input[value="Trip"]') }).first();
        await tripRow.hover();
        await tripRow.getByTitle('Delete row').click();
        await waitFor(async () => (await serverRows()).length === 1, 'only the unrelated row left on the server');
        eq((await serverRows())[0].id, other.id, 'the row that was not part of the branch is untouched');
        const shown = await page.locator('table tbody input:not([type=checkbox])').evaluateAll((els) => els.map((e) => e.value));
        ok(!shown.includes('Flights') && !shown.includes('Seats'), `sub-rows still on screen: ${JSON.stringify(shown)}`);
      });

    await check('Undo brings the whole branch back with the same ids, so comments and links still point at it',
      'A deleted row is often a slip. Putting it back as a new row would orphan its comments, its links from other tables and its mentions.',
      async () => {
        await page.getByRole('button', { name: 'Undo' }).click();
        await waitFor(async () => (await serverRows()).length === 4, 'all four rows on the server again');
        const back = Object.fromEntries((await serverRows()).map((r) => [r.id, r]));
        ok(back[trip.id] && back[flights.id] && back[seats.id], 'the same ids came back');
        eq(back[flights.id].parent, trip.id, 'Flights is under Trip again');
        eq(back[seats.id].parent, flights.id, 'Seats is under Flights again');
        eq(back[seats.id].cells?.cname, 'Seats', 'the cells came back');
        const c = await api.get('comments', note.id, me.token);
        eq(c.data?.row, flights.id, 'the comment still points at its row');
        await page.reload();
        await page.locator('table tbody tr').nth(3).waitFor({ timeout: 15000 });
        const shown = await page.locator('table tbody input:not([type=checkbox])').evaluateAll((els) => els.map((e) => e.value));
        ok(['Trip', 'Flights', 'Seats', 'Other'].every((n) => shown.includes(n)), `after a reload the grid shows ${JSON.stringify(shown)}`);
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused delete or restore is invisible in the grid.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
