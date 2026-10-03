import { startPocketBase } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq } from '../harness/runner.mjs';

export default async function () {
  suite('visibility: who can see what');
  const pb = await startPocketBase();
  const api = client(pb.url);
  try {
    const u = {};
    for (const n of ['alice', 'bob', 'cara', 'nobody', 'eve']) u[n] = await api.signup(n);
    const w1 = await api.workspace(u.alice, 'W1');
    const w2 = await api.workspace(u.cara, 'W2');
    const gone = await api.workspace(u.alice, 'Gone');
    await api.invite(u.alice, w1, u.bob, 'viewer');
    await api.invite(u.cara, w2, u.bob, 'editor');
    const members = { [w1.id]: ['alice', 'bob'], [w2.id]: ['bob', 'cara'], [gone.id]: ['alice'] };

    const specs = [
      { key: 'shared in W1', ws: w1, owner: 'alice' },
      { key: 'private, owner only', ws: w1, owner: 'alice', visibility: 'private' },
      { key: 'private, bob edits', ws: w1, owner: 'alice', visibility: 'private', editors: ['bob'] },
      { key: 'private, bob views', ws: w1, owner: 'alice', visibility: 'private', viewers: ['bob'] },
      { key: 'private, eve listed but not a member', ws: w1, owner: 'alice', visibility: 'private', editors: ['eve'], viewers: ['eve'] },
      { key: 'shared in W2 with a link', ws: w2, owner: 'cara', token: 'link-one' },
      { key: 'private in W2 with a link', ws: w2, owner: 'cara', visibility: 'private', token: 'link-two' },
      { key: 'no workspace', ws: { id: '' }, owner: 'alice' },
      { key: 'workspace deleted', ws: gone, owner: 'alice' },
    ];
    const pages = [];
    for (const s of specs) {
      const rec = await api.must(api.create('pages', {
        title: s.key, workspace: s.ws.id, owner: u[s.owner].id, visibility: s.visibility || '',
        editors: (s.editors || []).map((n) => u[n].id), viewers: (s.viewers || []).map((n) => u[n].id), publicToken: s.token || '',
      }, pb.adminToken), s.key);
      pages.push({ ...s, id: rec.id });
    }
    await api.must(api.remove('workspaces', gone.id, pb.adminToken), 'delete workspace');
    delete members[gone.id];

    const canSee = (who, p, token) => {
      if (p.token && token === p.token) return true;
      if (!who) return false;
      const inWs = (members[p.ws.id] || []).includes(who);
      if (!inWs) return false;
      if (p.visibility !== 'private') return true;
      return p.owner === who || (p.editors || []).includes(who) || (p.viewers || []).includes(who);
    };

    for (const who of Object.keys(u)) {
      await check(`${who} sees exactly the pages the rule promises`,
        'A page shows to members of its workspace, and a private one only to its owner, editors and viewers who are also members. Anything more leaks; anything less hides work from the person it belongs to.',
        async () => {
          const got = (await api.list('pages', u[who].token)).map((p) => p.title).sort();
          eq(got, pages.filter((p) => canSee(who, p)).map((p) => p.key).sort(), `pages ${who} can list`);
        });
    }

    await check('a share link opens exactly its own page, signed in or not',
      'The link is how a page reaches someone outside the workspace; it must open that page and nothing else.',
      async () => {
        for (const token of ['link-one', 'link-two', 'wrong']) {
          const anon = await api.list('pages', undefined, `&token=${token}`);
          eq(anon.map((p) => p.title).sort(), pages.filter((p) => canSee(null, p, token)).map((p) => p.key).sort(), `anonymous with ${token}`);
          const nobody = await api.list('pages', u.nobody.token, `&token=${token}`);
          eq(nobody.map((p) => p.title).sort(), pages.filter((p) => canSee('nobody', p, token)).map((p) => p.key).sort(), `nobody with ${token}`);
        }
      });

    const t1 = await api.must(api.create('tables', { name: 'T1', workspace: w1.id }, u.alice.token), 't1');
    await api.must(api.create('table_rows', { table: t1.id, workspace: w1.id, cells: {} }, u.alice.token), 'row');
    const shared = pages.find((p) => p.key === 'shared in W1');
    await api.must(api.create('comments', { page: shared.id, author: u.alice.id, authorName: u.alice.name, body: 'x' }, u.alice.token), 'comment');
    await api.must(api.create('presence', { page: shared.id, user: u.alice.id, mode: 'viewing' }, u.alice.token), 'presence');
    await api.must(api.create('workspace_keys', { workspace: w1.id, user: u.alice.id, wrappedKey: 'k' }, u.alice.token), 'key');

    for (const coll of ['tables', 'table_rows', 'comments', 'presence', 'workspace_keys']) {
      await check(`${coll} of W1 reach W1's members and nobody else`,
        'Every per-page and per-workspace record follows the same membership boundary as its page; one collection that forgot it is enough to leak a workspace.',
        async () => {
          for (const who of Object.keys(u)) {
            const n = (await api.list(coll, u[who].token)).length;
            eq(n > 0, ['alice', 'bob'].includes(who), `${who} sees ${n} ${coll}`);
          }
        });
    }

    await check("a workspace's roster is visible to its members only",
      'Members need to see each other to share and grant keys; outsiders must not learn who is in a workspace.',
      async () => {
        for (const who of Object.keys(u)) {
          const got = (await api.list('workspace_members', u[who].token)).map((m) => m.workspace);
          const want = Object.entries(members).filter(([, list]) => list.includes(who)).map(([ws]) => ws);
          eq([...new Set(got)].sort(), want.sort(), `workspaces whose roster ${who} can see`);
        }
      });
  } finally {
    await pb.stop();
  }
}
