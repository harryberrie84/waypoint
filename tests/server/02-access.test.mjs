import { startPocketBase } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, ok } from '../harness/runner.mjs';

const refused = (r, what) => ok(r.status >= 400 && r.status < 500, `${what}: expected a refusal, got ${r.status} ${r.text.slice(0, 200)}`);
const allowed = (r, what) => ok(r.status >= 200 && r.status < 300, `${what}: expected success, got ${r.status} ${r.text.slice(0, 200)}`);

export const SETUPS = [
  { label: 'every hook, as the Docker image runs', options: {} },
  { label: 'only the invite email hook, as live runs', options: { onlyHooks: ['invite_email.pb.js'] } },
];

export default async function () {
  for (const setup of SETUPS) await run(setup);
}

async function run({ label, options }) {
  suite(`access: who may do what (${label})`);
  const pb = await startPocketBase(options);
  const api = client(pb.url);
  try {
    const owner = await api.signup('owner');
    const viewer = await api.signup('viewer');
    const outsider = await api.signup('outsider');
    const ws = await api.workspace(owner, 'Owner space');
    const outsiderWs = await api.workspace(outsider, 'Outsider space');
    const viewerMember = await api.invite(owner, ws, viewer, 'viewer');
    const page = await api.must(api.create('pages', { title: 'owner page', workspace: ws.id, owner: owner.id }, owner.token), 'page');
    const outsiderPage = await api.must(api.create('pages', { title: 'x', workspace: outsiderWs.id, owner: outsider.id }, outsider.token), 'outsider page');

    await check('a viewer cannot make themselves admin',
      'Roles are the only thing between a read-only guest and full control of a workspace, including removing its owner.',
      async () => refused(await api.update('workspace_members', viewerMember.id, { role: 'admin' }, viewer.token), 'viewer promotes self'));

    await check('a member cannot remove the owner',
      'Losing the owner row locks the owner out of their own workspace.',
      async () => refused(await api.remove('workspace_members', ws.ownerMember.id, viewer.token), 'viewer deletes owner membership'));

    await check('nobody can move a membership into a workspace they were not invited to',
      'Moving your own membership row to another workspace id granted full read access to it; workspace ids are visible on every uploaded image.',
      async () => {
        refused(await api.update('workspace_members', outsiderWs.ownerMember.id, { workspace: ws.id }, outsider.token), 'outsider moves membership');
        const seen = await api.list('pages', outsider.token);
        ok(!seen.some((p) => p.id === page.id), 'outsider can read the owner page');
      });

    await check('nobody joins without an invite',
      'Membership is the boundary every other rule relies on.',
      async () => refused(await api.create('workspace_members', { workspace: ws.id, user: outsider.id, role: 'admin' }, outsider.token), 'outsider seats self'));

    await check("a member cannot overwrite someone else's public key",
      "Encrypted workspaces wrap their key to each member's public key; swapping it redirects future keys to the attacker.",
      async () => refused(await api.update('workspace_members', ws.ownerMember.id, { publicKey: 'evil' }, viewer.token), 'viewer overwrites owner public key'));

    await check('nobody writes into a workspace they are not in',
      "Pages, tables, comments, presence, Yjs updates and trash entries from outside showed up in the owner's workspace; an injected Yjs update rewrote the page body.",
      async () => {
        refused(await api.create('pages', { title: 'x', workspace: ws.id }, outsider.token), 'outsider creates page');
        refused(await api.create('tables', { name: 'x', workspace: ws.id }, outsider.token), 'outsider creates table');
        refused(await api.create('comments', { page: page.id, author: outsider.id, authorName: 'Owner', body: 'x', mentions: [owner.id] }, outsider.token), 'outsider comments');
        refused(await api.create('yupdates', { page: page.id, workspace: '', data: 'AAAA' }, outsider.token), 'outsider yupdate with no workspace');
        refused(await api.create('yupdates', { page: page.id, workspace: ws.id, data: 'AAAA' }, outsider.token), 'outsider yupdate claiming the workspace');
        refused(await api.create('presence', { page: page.id, user: outsider.id, mode: 'viewing' }, outsider.token), 'outsider presence');
        refused(await api.create('file_trash', { workspace: ws.id, url: 'https://evil.example', name: 'x' }, outsider.token), 'outsider trash entry');
      });

    await check('a page cannot be moved into a workspace its mover is not in',
      'A move would otherwise plant content in someone else’s workspace.',
      async () => refused(await api.update('pages', page.id, { workspace: outsiderWs.id }, owner.token), 'owner moves page to outsider space'));

    await check('an invite grants the role it was sent with, not a bigger one',
      'Otherwise anyone invited as a viewer can accept as admin.',
      async () => {
        const late = await api.signup('late');
        await api.must(api.create('workspace_invites', { workspace: ws.id, email: late.email, role: 'viewer', invitedBy: owner.id, status: 'pending' }, owner.token), 'invite');
        const seated = await api.list('workspace_members', late.token, `&filter=${encodeURIComponent(`user="${late.id}" && workspace="${ws.id}"`)}`);
        if (seated.length) {
          ok(seated[0].role === 'viewer', `the hook seated the invitee as ${seated[0].role}, not viewer`);
          return;
        }
        refused(await api.create('workspace_members', { workspace: ws.id, user: late.id, role: 'admin' }, late.token), 'accept as admin');
        allowed(await api.create('workspace_members', { workspace: ws.id, user: late.id, role: 'viewer' }, late.token), 'accept as viewer');
      });

    await check('everything the app does day to day is still allowed',
      'A rule that is too tight breaks the app for everyone, silently: the write fails and the change is lost on reload.',
      async () => {
        const member = await api.signup('member');
        const m = await api.invite(owner, ws, member, 'editor');
        allowed(await api.update('workspace_members', m.id, { role: 'viewer' }, owner.token), 'owner changes a role');
        allowed(await api.update('workspace_members', m.id, { publicKey: 'pk', userName: 'M' }, member.token), 'member sets own key and name');
        const p = await api.create('pages', { title: 'm', workspace: ws.id, owner: member.id }, member.token);
        allowed(p, 'member creates a page');
        allowed(await api.update('pages', page.id, { title: 'edited' }, member.token), "member edits the owner's page");
        const t = await api.create('tables', { name: 't', workspace: ws.id }, member.token);
        allowed(t, 'member creates a table');
        allowed(await api.create('table_rows', { table: t.data.id, workspace: ws.id, cells: {} }, member.token), 'member adds a row');
        allowed(await api.create('yupdates', { page: page.id, workspace: ws.id, data: 'AAAA' }, member.token), 'member types (Yjs update)');
        allowed(await api.create('page_versions', { page: page.id, workspace: ws.id, content: '{}' }, member.token), 'page backup');
        allowed(await api.create('comments', { page: page.id, author: member.id, authorName: 'M', body: 'hi' }, member.token), 'member comments');
        const pres = await api.create('presence', { page: page.id, user: member.id, mode: 'viewing' }, member.token);
        allowed(pres, 'presence on a page');
        allowed(await api.update('presence', pres.data.id, { page: page.id, user: member.id, mode: 'editing', heartbeat: new Date().toISOString() }, member.token), 'presence heartbeat');
        refused(await api.update('presence', pres.data.id, { page: outsiderPage.id, user: member.id }, member.token), 'presence moved onto a foreign page');
        allowed(await api.create('file_trash', { workspace: ws.id, url: '/api/files/x', name: 'x', status: 'pending' }, member.token), 'trash entry');
        allowed(await api.create('workspace_keys', { workspace: ws.id, user: member.id, wrappedKey: 'k' }, owner.token), 'owner grants a key');
        const k = await api.create('workspace_keys', { workspace: ws.id, user: owner.id, wrappedKey: 'k2' }, member.token);
        allowed(k, 'member grants a key');
        refused(await api.remove('workspace_keys', k.data.id, viewer.token), "viewer deletes the owner's key");
        const ws3 = await api.workspace(owner, 'Second');
        allowed(await api.update('pages', page.id, { workspace: ws3.id }, owner.token), 'owner moves a page between own workspaces');
        allowed(await api.update('pages', page.id, { workspace: ws.id }, owner.token), 'and back');
        const up = new FormData();
        up.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
        up.append('workspace', '');
        allowed(await api.call('POST', '/api/collections/uploads/records', undefined, member.token, { form: up }), 'upload before a workspace is chosen');
        allowed(await api.remove('workspace_members', m.id, member.token), 'member leaves');
        const again = await api.signup('again');
        const a = await api.invite(owner, ws, again, 'editor');
        allowed(await api.remove('workspace_members', a.id, owner.token), 'owner removes a member');
      });

    await check('a new account can create its first workspace and seat itself',
      'This is the first thing every new user does; if it fails they land in an app that cannot save anything.',
      async () => {
        const fresh = await api.signup('fresh');
        await api.workspace(fresh, 'Mine');
      });
  } finally {
    await pb.stop();
  }
}
