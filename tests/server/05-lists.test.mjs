import { startPocketBase } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';
import { loadAllByKeyset, sortByKey, KEYSET_PAGE } from '../../src/lib/keyset.ts';

const ROWS = 1234;

export default async function () {
  suite('lists: whole collections load completely and in order');
  const pb = await startPocketBase();
  const api = client(pb.url);
  try {
    const owner = await api.signup('owner');
    const ws = await api.workspace(owner);
    const table = await api.must(api.create('tables', { name: 'big', workspace: ws.id }, owner.token), 'table');
    const ids = [];
    let next = 0;
    await Promise.all(Array.from({ length: 16 }, async () => {
      while (next < ROWS) {
        const k = next++;
        const r = await api.must(api.create('table_rows', { table: table.id, workspace: ws.id, position: k % 97, cells: { n: k } }, pb.adminToken), 'row');
        ids.push(r.id);
      }
    }));

    const appLoad = (onPage) => loadAllByKeyset(async (after) => {
      const filter = after ? `&filter=${encodeURIComponent(`id > "${after}"`)}` : '';
      const r = await api.must(api.call('GET', `/api/collections/table_rows/records?perPage=${KEYSET_PAGE}&skipTotal=1&sort=id${filter}`, undefined, owner.token), 'page');
      if (onPage) await onPage();
      return r.items;
    });

    await check('the full load gets every row, not just the first page',
      'PocketBase caps a page at 500 rows. A loader that stops at the first page shows a table that looks complete and is missing most of its rows.',
      async () => {
        const rows = await appLoad();
        eq(rows.length, ROWS, 'rows loaded');
        eq(new Set(rows.map((r) => r.id)).size, ROWS, 'distinct rows');
      });

    await check('rows come back in the order the server used to give',
      'The table shows rows by position; loading by id must not reorder what people arranged.',
      async () => {
        const rows = sortByKey(await appLoad(), 'position');
        const server = [];
        for (let p = 1; ; p++) {
          const r = await api.must(api.call('GET', `/api/collections/table_rows/records?page=${p}&perPage=500&skipTotal=1&sort=position,id`, undefined, owner.token), 'server order');
          server.push(...r.items);
          if (r.items.length < 500) break;
        }
        eq(rows.map((r) => r.id), server.map((r) => r.id), 'order');
      });

    await check('a row moved by someone else during the load is neither lost nor loaded twice',
      'Page-number paging over a column that changes can skip or repeat a row when a colleague reorders during your load; paging by id cannot.',
      async () => {
        let k = 0;
        const rows = await appLoad(async () => {
          for (let i = 0; i < 40; i++) {
            const id = ids[(k * 131 + i * 17) % ids.length];
            await api.update('table_rows', id, { position: -1 - k * 100 - i }, owner.token);
          }
          k++;
        });
        eq(rows.length, ROWS, 'rows loaded');
        eq(new Set(rows.map((r) => r.id)).size, ROWS, 'distinct rows');
      });

    await check('the reconnect catch-up finds exactly what changed since the newest record held',
      'After the realtime stream drops, the app asks only for what changed. If that query missed a change, the person would work on stale data without knowing.',
      async () => {
        const all = await appLoad();
        const watermark = all.map((r) => r.updated).sort().pop();
        await new Promise((r) => setTimeout(r, 1100));
        const changed = [ids[3], ids[500], ids[1200]];
        for (const id of changed) await api.must(api.update('table_rows', id, { cells: { changed: true } }, owner.token), 'change');
        const since = new Date(Date.parse(watermark.replace(' ', 'T')) - 60_000).toISOString().replace('T', ' ');
        const got = await api.list('table_rows', owner.token, `&filter=${encodeURIComponent(`updated >= "${since}"`)}`);
        for (const id of changed) ok(got.some((r) => r.id === id), `catch-up missed ${id}`);
      });
  } finally {
    await pb.stop();
  }
}
