import { startPocketBase } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, ok, eq } from '../harness/runner.mjs';

const refused = (r, what) => ok(r.status >= 400 && r.status < 500, `${what}: expected a refusal, got ${r.status} ${r.text.slice(0, 200)}`);

export default async function () {
  suite('saves: overlapping saves keep every field');
  const pb = await startPocketBase();
  const api = client(pb.url);
  const save = (coll, id, body, token) => api.call('PATCH', `/api/waypoint/save/${coll}/${id}`, body, token);
  try {
    const owner = await api.signup('owner');
    const ws = await api.workspace(owner);
    const viewer = await api.signup('viewer');
    await api.invite(owner, ws, viewer, 'viewer');
    const ed = await api.signup('ed');
    await api.invite(owner, ws, ed, 'editor');
    const outsider = await api.signup('outsider');

    await check('saves to different fields of the same page at the same moment all survive',
      'PocketBase writes every column back on each save, so a body save and a spreadsheet save that overlapped undid each other; in the stress test 45 of 70 fields were lost this way.',
      async () => {
        let lost = 0;
        for (let trial = 0; trial < 10; trial++) {
          const p = await api.must(api.create('pages', { title: 't', workspace: ws.id, owner: owner.id }, owner.token), 'page');
          const patches = [{ sheet: { cells: { A1: `x${trial}` } } }, { rota: { jobs: [trial] } }, { bracket: { e: [trial] } }, { cards: [{ id: `c${trial}` }] }, { cover: `grad-${trial}` }, { icon: '🔥' }, { title: `T${trial}` }];
          const res = await Promise.all(patches.map((b) => save('pages', p.id, b, owner.token)));
          ok(res.every((r) => r.status === 200), `a save failed: ${res.map((r) => r.status).join()}`);
          const back = (await api.get('pages', p.id, owner.token)).data;
          lost += patches.filter((b) => { const [k, v] = Object.entries(b)[0]; return JSON.stringify(back[k]) !== JSON.stringify(v); }).length;
        }
        eq(lost, 0, 'fields lost across 10 rounds of 7 overlapping saves');
      });

    await check('the save route follows exactly the same access rules as a normal save',
      'A second way to write must not be a way around the rules.',
      async () => {
        const p = await api.must(api.create('pages', { title: 'mine', workspace: ws.id, owner: owner.id }, owner.token), 'page');
        refused(await save('pages', p.id, { title: 'x' }, viewer.token), 'viewer saves');
        refused(await save('pages', p.id, { title: 'x' }, outsider.token), 'outsider saves');
        refused(await save('pages', p.id, { owner: ed.id }, ed.token), 'editor takes ownership');
        refused(await save('pages', p.id, { visibility: 'private' }, ed.token), 'editor hides the page');
        ok((await save('pages', p.id, { title: 'by ed' }, ed.token)).status === 200, 'an editor edits the title');
        refused(await save('users', owner.id, { name: 'x' }, owner.token), 'a collection the route does not serve');
        refused(await save('pages', 'nopenopenopeno1', { title: 'x' }, owner.token), 'a page that does not exist');
        const t = await api.must(api.create('tables', { name: 't', workspace: ws.id }, owner.token), 'table');
        const r = await api.must(api.create('table_rows', { table: t.id, workspace: ws.id, cells: {} }, owner.token), 'row');
        refused(await save('table_rows', r.id, { cells: { a: 1 } }, viewer.token), 'viewer edits a row');
        ok((await save('table_rows', r.id, { cells: { a: 1 } }, ed.token)).status === 200, 'an editor edits a row');
        refused(await save('pages', p.id, { title: 'x'.repeat(600) }, owner.token), 'a title longer than the field allows');
      });

    await check('two people changing different cells of one row at the same moment both keep their change',
      'A row keeps all its cells in one field. Each person sent the whole set as they last read it, so the later save put back the old value of the other person\'s cell.',
      async () => {
        const t = await api.must(api.create('tables', { name: 'cells', workspace: ws.id }, owner.token), 'table');
        let lost = 0;
        for (let trial = 0; trial < 10; trial++) {
          const r = await api.must(api.create('table_rows', { table: t.id, workspace: ws.id, cells: { a: 'old', b: 0, c: 'keep' } }, owner.token), 'row');
          const res = await Promise.all([
            save('table_rows', r.id, { cellsMerge: { a: `owner ${trial}` } }, owner.token),
            save('table_rows', r.id, { cellsMerge: { b: trial + 1 } }, ed.token),
          ]);
          ok(res.every((x) => x.status === 200), `a save failed: ${res.map((x) => x.status).join()}`);
          const back = (await api.get('table_rows', r.id, owner.token)).data.cells;
          if (back.a !== `owner ${trial}`) lost++;
          if (back.b !== trial + 1) lost++;
          eq(back.c, 'keep', 'a cell nobody touched');
        }
        eq(lost, 0, 'cell edits lost across 10 rounds of two overlapping saves');
      });

    await check('merging cells keeps the access rules, and leaves sealed cells to the app',
      'The merge is a second way to write a row. It must refuse whoever a normal save refuses, and must not touch encrypted cells it cannot read.',
      async () => {
        const t = await api.must(api.create('tables', { name: 'rules', workspace: ws.id }, owner.token), 'table');
        const r = await api.must(api.create('table_rows', { table: t.id, workspace: ws.id, cells: { a: 1 } }, owner.token), 'row');
        refused(await save('table_rows', r.id, { cellsMerge: { a: 2 } }, viewer.token), 'viewer merges a cell');
        refused(await save('table_rows', r.id, { cellsMerge: { a: 2 } }, outsider.token), 'outsider merges a cell');
        eq((await api.get('table_rows', r.id, owner.token)).data.cells.a, 1, 'the refused merges changed nothing');
        const sealed = await api.must(api.create('table_rows', { table: t.id, workspace: ws.id, cells: { __enc: 'enc:v1:abc' } }, owner.token), 'sealed row');
        refused(await save('table_rows', sealed.id, { cellsMerge: { a: 2 } }, owner.token), 'a merge into sealed cells');
        eq((await api.get('table_rows', sealed.id, owner.token)).data.cells, { __enc: 'enc:v1:abc' }, 'the sealed cells are untouched');
      });
  } finally {
    await pb.stop();
  }
}
