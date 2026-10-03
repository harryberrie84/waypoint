import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPocketBase, SOURCE } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const CLIENT_WRITES = {
  pages: ['title', 'icon', 'cover', 'parent', 'order', 'content', 'kanban', 'visibility', 'editors', 'viewers', 'publicToken', 'template', 'map', 'flow', 'tierlist', 'rates', 'sheet', 'cards', 'rota', 'bracket', 'mindmap', 'photos', 'files', 'defaultTab', 'trashed', 'ydoc'],
  tables: ['name', 'columns', 'views', 'automations', 'formKey'],
  table_rows: ['cells', 'position', 'parent', 'reactions', 'content'],
  workspaces: ['name', 'icon', 'tabletop', 'encrypted', 'numberStyle'],
  comments: ['body', 'authorName', 'thread', 'row', 'mentions'],
  presence: ['userName', 'mode', 'heartbeat', 'cursor', 'focus'],
  users: ['name', 'prefs'],
};

const EXPECTED_INDEXES = {
  pages: ['workspace', 'parent', 'updated'],
  tables: ['workspace', 'updated'],
  table_rows: ['table', 'workspace', 'updated'],
  comments: ['page', 'thread', 'row'],
  presence: ['page', 'user'],
  workspace_invites: ['email'],
  uploads: ['workspace'],
  file_trash: ['workspace'],
  yupdates: ['page'],
  page_versions: ['page'],
};

function sample(field, user) {
  switch (field.type) {
    case 'bool': return true;
    case 'number': return 7;
    case 'json': return { kept: ['a', 1, true], nested: { v: 'å' } };
    case 'relation': return field.options.maxSelect === 1 ? '' : [user.id];
    case 'select': return field.options.values[0];
    case 'date': return '2026-10-01 10:00:00.000Z';
    default: return field.name === 'heartbeat' ? '2026-10-01T10:00:00.000Z' : `kept ${field.name}`;
  }
}

export default async function () {
  suite('schema: what the database keeps');
  const pb = await startPocketBase();
  const api = client(pb.url);
  const schema = JSON.parse(readFileSync(join(SOURCE, 'pocketbase', 'schema.json'), 'utf8'));
  const byName = Object.fromEntries(schema.map((c) => [c.name, c]));
  try {
    await check('a fresh install starts with no migration errors',
      'PocketBase exits at start when a migration throws, and a restart loop takes the whole instance down.',
      async () => {
        ok(!/error|failed/i.test(pb.log().replace(/Server started[^\n]*/g, '')), 'start log mentions an error:\n' + pb.log());
      });

    const owner = await api.signup('owner');
    const ws = await api.workspace(owner);
    const page = await api.must(api.create('pages', { title: 'p', workspace: ws.id, owner: owner.id }, owner.token), 'page');
    const table = await api.must(api.create('tables', { name: 't', workspace: ws.id, owner: owner.id }, owner.token), 'table');
    const row = await api.must(api.create('table_rows', { table: table.id, workspace: ws.id }, owner.token), 'row');
    const comment = await api.must(api.create('comments', { page: page.id, author: owner.id, authorName: owner.name, body: 'x' }, owner.token), 'comment');
    const presence = await api.must(api.create('presence', { page: page.id, user: owner.id, mode: 'viewing' }, owner.token), 'presence');
    const target = { pages: page, tables: table, table_rows: row, workspaces: ws, comments: comment, presence, users: { id: owner.id } };

    for (const [coll, fields] of Object.entries(CLIENT_WRITES)) {
      await check(`${coll}: every field the app writes is still there after a reload`,
        'PocketBase drops a field its schema lacks and still answers 200, so the app looks saved until the next reload. This is how Trash, saved views, automations and the number style silently stopped working.',
        async () => {
          const defs = byName[coll].schema;
          const body = {};
          const missing = fields.filter((f) => !defs.some((d) => d.name === f));
          eq(missing, [], `fields the app writes that ${coll} does not have`);
          for (const f of fields) body[f] = sample(defs.find((d) => d.name === f), owner);
          if (coll === 'comments' && 'authorName' in body) body.authorName = owner.name;
          await api.must(api.update(coll, target[coll].id, body, owner.token), `save ${coll}`);
          const back = await api.must(api.get(coll, target[coll].id, owner.token), `read ${coll}`);
          for (const f of fields) eq(back[f], body[f], `${coll}.${f} read back`);
        });
    }

    await check('indexes exist on everything the app filters by',
      'Without them each page open, rule check and realtime broadcast scans a whole collection; it is what made saves slower with every member.',
      async () => {
        for (const [coll, cols] of Object.entries(EXPECTED_INDEXES)) {
          const c = (await api.call('GET', `/api/collections/${coll}`, undefined, pb.adminToken)).data;
          for (const col of cols) ok(c.indexes.some((i) => i.includes(`(\`${col}\`)`)), `${coll} has no index on ${col}: ${JSON.stringify(c.indexes)}`);
        }
      });

    await check('the pages list without the Yjs snapshot still has every other field',
      'The app loads pages without ydoc to save megabytes; a field missing from that list would load as empty and could be saved back empty.',
      async () => {
        const fields = readFileSync(join(SOURCE, 'src', 'lib', 'pageFields.ts'), 'utf8').match(/'([a-zA-Z]+)'/g).map((s) => s.slice(1, -1));
        const r = await api.must(api.call('GET', `/api/collections/pages/records?perPage=1&fields=${fields.join(',')}`, undefined, owner.token), 'list');
        const keys = Object.keys(r.items[0]).sort();
        const want = ['id', 'collectionId', 'collectionName', 'created', 'updated', ...byName.pages.schema.map((f) => f.name).filter((n) => n !== 'ydoc')].sort();
        eq(keys, want, 'fields in a listed page');
      });

    await check('restarting leaves the data and schema alone',
      'Every deploy restarts PocketBase and reruns migrations; one that is not idempotent fails the second start or duplicates a column.',
      async () => {
        await pb.stop({ keep: true });
        const again = await startPocketBase({ dir: pb.dir });
        try {
          const api2 = client(again.url);
          const back = await api2.must(api2.get('pages', page.id, owner.token), 'read after restart');
          eq(back.trashed, true, 'trashed survives a restart');
          ok(!/error|failed/i.test(again.log().replace(/Server started[^\n]*/g, '')), 'second start log mentions an error:\n' + again.log());
        } finally {
          await again.stop({ keep: true });
        }
      });
  } finally {
    await pb.stop();
  }
}
