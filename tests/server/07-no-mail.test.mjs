import { startPocketBase } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const settle = () => new Promise((r) => setTimeout(r, 600));

export default async function () {
  suite('no mail set up: everything that would send an email still saves');
  const pb = await startPocketBase({ mail: false });
  const api = client(pb.url);
  try {
    const alice = await api.signup('alice');
    const ws = await api.workspace(alice);

    await check('an invite is saved and can be accepted when the email cannot be sent',
      'A fresh install has no SMTP. Inviting must not fail or half-save because the mail did not go.',
      async () => {
        const bob = await api.signup('bob');
        const seat = await api.invite(alice, ws, bob, 'editor');
        eq(seat.role, 'editor', 'bob seated with the invited role');
      });

    await check('a comment with a mention is saved when the email cannot be sent',
      'A mention that fails to mail must still leave the comment where people can read it.',
      async () => {
        const bob = (await api.list('workspace_members', alice.token)).find((m) => m.user !== alice.id);
        const page = await api.must(api.create('pages', { title: 'p', workspace: ws.id, owner: alice.id }, alice.token), 'page');
        const c = await api.create('comments', { page: page.id, author: alice.id, authorName: alice.name, body: 'look', mentions: [bob.user] }, alice.token);
        eq(c.status, 200, `comment create answered ${c.status} ${c.text.slice(0, 200)}`);
      });

    await check('a due reminder does not break the cron when the email cannot be sent',
      'The cron runs every few minutes; one unsendable mail must not throw and stop it.',
      async () => {
        const table = await api.must(api.create('tables', { name: 'Plan', workspace: ws.id, owner: alice.id, columns: [{ id: 'r', name: 'Due', type: 'reminder', reminderLead: '1h' }, { id: 'p', name: 'Who', type: 'person' }] }, alice.token), 'table');
        await api.must(api.create('table_rows', { table: table.id, workspace: ws.id, cells: { r: new Date(Date.now() + 1800000).toISOString(), p: [alice.id] } }, alice.token), 'row');
        const runs = (await api.call('POST', '/__test/cron/reminders')).status;
        eq(runs, 200, 'the reminder run');
      });

    await check('the server is still up and answering after the failed sends',
      'A hook that crashes on a send failure takes requests down with it.',
      async () => {
        await settle();
        eq((await api.call('GET', '/api/health')).status, 200, 'health');
      });
  } finally {
    await pb.stop();
  }
}
