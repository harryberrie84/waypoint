import { startPocketBase } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { htmlPart } from '../harness/smtp.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const settle = () => new Promise((r) => setTimeout(r, 400));

export default async function () {
  suite('hooks: mail, reminders, calendar feed, link previews');
  const pb = await startPocketBase();
  const api = client(pb.url);
  try {
    const alice = await api.signup('alice');
    const bob = await api.signup('bob');
    const outsider = await api.signup('outsider');
    const ws = await api.workspace(alice, 'Trip <b>crew</b> & co');
    await api.invite(alice, ws, bob, 'editor');
    await settle();

    await check('an invite emails the invitee, with the workspace name as text, not markup',
      'The invite is how anyone joins. Its names are typed by the inviter and land in someone else’s inbox, where markup could pose as a real link.',
      async () => {
        const invitee = `new-${Date.now()}@example.org`;
        pb.smtp.clear();
        const token = api.inviteToken();
        await api.must(api.create('workspace_invites', { workspace: ws.id, email: invitee, role: 'editor', invitedBy: alice.id, status: 'pending', token }, alice.token), 'invite');
        await settle();
        const mail = pb.smtp.to(invitee);
        eq(mail.length, 1, 'mails to the invitee');
        const body = htmlPart(mail[0].data);
        ok(body.includes(`t=${token}`), 'the invite link lacks its one-time secret, so an unverified invitee could not join');
        ok(body.includes('Trip &lt;b&gt;crew&lt;/b&gt; &amp; co'), 'workspace name not escaped in:\n' + body.slice(0, 600));
        ok(!body.includes('<b>crew</b>'), 'raw markup reached the HTML part of the email');
      });

    const page = await api.must(api.create('pages', { title: 'p', workspace: ws.id, owner: alice.id }, alice.token), 'page');

    await check('a mention emails the mentioned member, and nobody else',
      'Mentions were never delivered (the hook read the list as bytes). Now that they are, a mention of an account outside the workspace must not become mail on request to anyone.',
      async () => {
        pb.smtp.clear();
        await api.must(api.create('comments', { page: page.id, author: alice.id, authorName: 'Alice <script>', body: 'look <img src=x onerror=alert(1)>', mentions: [bob.id, outsider.id, alice.id] }, alice.token), 'comment');
        await settle();
        eq(pb.smtp.messages.map((m) => m.to).flat().sort(), [bob.email], 'recipients');
        const body = htmlPart(pb.smtp.messages[0].data);
        ok(!body.includes('<img src=x'), 'comment markup reached the email');
        ok(body.includes('&lt;img'), 'comment text missing or unescaped:\n' + body.slice(0, 600));
      });

    const due = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const table = await api.must(api.create('tables', {
      name: 'Plan', workspace: ws.id, owner: alice.id,
      columns: [{ id: 't', name: 'Title', type: 'text' }, { id: 'd', name: 'When', type: 'date' }, { id: 'r', name: 'Due', type: 'reminder', reminderLead: '1h' }, { id: 'p', name: 'Who', type: 'person' }],
    }, alice.token), 'table');
    await api.must(api.create('table_rows', { table: table.id, workspace: ws.id, cells: { t: 'Ferry <b>9:00</b>', d: '2026-10-01', r: due, p: [bob.id, outsider.id] } }, alice.token), 'row');

    await check('a due reminder emails the people in its row who are members, once',
      'Reminders had never fired. They must reach the people named on the row, not an arbitrary account written into the cell, and must not repeat every ten minutes.',
      async () => {
        pb.smtp.clear();
        await api.must(api.call('POST', '/__test/cron/reminders'), 'run the reminder job');
        await settle();
        eq(pb.smtp.messages.map((m) => m.to).flat().sort(), [bob.email], 'recipients of the first run');
        ok(!htmlPart(pb.smtp.messages[0].data).includes('<b>9:00</b>'), 'row title markup reached the email');
        pb.smtp.clear();
        await api.must(api.call('POST', '/__test/cron/reminders'), 'run it again');
        await settle();
        eq(pb.smtp.messages.length, 0, 'mails on the second run');
      });

    await check('the calendar feed serves members, and nobody else',
      'The feed returns every dated row of a table. It came out empty before the JSON fix; once it works it must not hand those rows to anyone holding a table id.',
      async () => {
        const anon = await api.call('GET', `/ics/table/${table.id}`);
        eq(anon.status, 401, 'without an account');
        const other = await api.call('GET', `/ics/table/${table.id}`, undefined, outsider.token);
        eq(other.status, 404, 'as someone outside the workspace');
        const member = await api.call('GET', `/ics/table/${table.id}`, undefined, bob.token);
        eq(member.status, 200, 'as a member');
        eq((member.text.match(/BEGIN:VEVENT/g) || []).length, 1, 'events in the feed');
      });

    await check('link previews refuse every way of naming this server or the local network',
      'The preview fetches whatever URL a user pastes, from inside the server. Reaching localhost or the LAN through it exposes the admin UI and anything else behind the firewall.',
      async () => {
        for (const url of ['http://[::1]:8090/', 'http://[::ffff:127.0.0.1]/', 'http://localhost./', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.0.0.1:8090/_/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://user:pw@example.com/', 'file:///etc/passwd']) {
          const r = await api.call('GET', `/link-preview?url=${encodeURIComponent(url)}`, undefined, alice.token);
          eq(r.status, 400, `preview of ${url}`);
        }
        const pub = await api.call('GET', `/link-preview?url=${encodeURIComponent('https://example.com/')}`, undefined, alice.token);
        ok(pub.status === 200 || pub.status === 204, `a public address was refused: ${pub.status} ${pub.text}`);
        const anon = await api.call('GET', `/link-preview?url=${encodeURIComponent('https://example.com/')}`);
        ok(anon.status === 401 || anon.status === 403, `previews without an account: ${anon.status}`);
      });

    await check('signing up through the invite link joins that workspace with the invited role, and only then',
      'This is how invited people arrive; if it breaks they sign up into an empty app. Signing up with the address alone must not be enough, or anyone could take the seat first.',
      async () => {
        const email = `joiner-${Date.now()}@example.org`;
        const token = api.inviteToken();
        await api.must(api.create('workspace_invites', { workspace: ws.id, email, role: 'viewer', invitedBy: alice.id, status: 'pending', token }, alice.token), 'invite');
        await api.must(api.create('users', { email, password: 'Passw0rd!2345', passwordConfirm: 'Passw0rd!2345', name: 'Joiner' }), 'sign up');
        const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: email, password: 'Passw0rd!2345' }), 'sign in');
        const before = await api.list('workspace_members', auth.token, `&filter=${encodeURIComponent(`user="${auth.record.id}"`)}`);
        eq(before.length, 0, 'memberships after signing up without the link');
        await api.must(api.call('POST', '/api/waypoint/invites/claim', { token }, auth.token), 'open the link');
        const seats = await api.list('workspace_members', auth.token, `&filter=${encodeURIComponent(`user="${auth.record.id}"`)}`);
        eq(seats.map((m) => [m.workspace, m.role]), [[ws.id, 'viewer']], 'memberships after using the link');
      });
  } finally {
    await pb.stop();
  }
}
