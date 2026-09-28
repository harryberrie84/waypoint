import { startPocketBase } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, ok } from '../harness/runner.mjs';

const refused = (r, what) => ok(r.status >= 400 && r.status < 500, `${what}: expected a refusal, got ${r.status} ${r.text.slice(0, 200)}`);
const allowed = (r, what) => ok(r.status >= 200 && r.status < 300, `${what}: expected success, got ${r.status} ${r.text.slice(0, 200)}`);

export const SETUPS = [
  { label: 'every hook, as the Docker image runs', options: {} },
  { label: 'only the invite hooks, as live runs', options: { onlyHooks: ['invite_email.pb.js', 'invite_claim.pb.js'] } },
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
      'Otherwise anyone invited as a viewer can accept as admin, for example by pairing their invite with someone else’s pending admin invite.',
      async () => {
        const late = await api.signup('late');
        const other = await api.signup('other');
        await api.must(api.create('workspace_invites', { workspace: ws.id, email: other.email, role: 'admin', invitedBy: owner.id, status: 'pending', token: api.inviteToken() }, owner.token), 'admin invite for someone else');
        const token = api.inviteToken();
        await api.must(api.create('workspace_invites', { workspace: ws.id, email: late.email, role: 'viewer', invitedBy: owner.id, status: 'pending', token }, owner.token), 'viewer invite');
        refused(await api.create('workspace_members', { workspace: ws.id, user: late.id, role: 'admin' }, late.token), 'invitee seats self as admin');
        refused(await api.create('workspace_members', { workspace: ws.id, user: late.id, role: 'viewer' }, late.token), 'invitee seats self directly');
        allowed(await api.call('POST', '/api/waypoint/invites/claim', { token }, late.token), 'claim with the link');
        const seated = await api.list('workspace_members', late.token, `&filter=${encodeURIComponent(`user="${late.id}" && workspace="${ws.id}"`)}`);
        ok(seated.length === 1 && seated[0].role === 'viewer', `seated as ${seated.map((m) => m.role).join()}, expected viewer`);
      });

    await check('an invite only seats the person it was sent to',
      'Anyone could register an account under the invited address before its owner did and take the seat, admin role included; nothing checked that the address was theirs.',
      async () => {
        const squatter = await api.signup('squatter');
        const target = `target-${Date.now().toString(36)}@example.org`;
        const token = api.inviteToken();
        await api.must(api.create('workspace_invites', { workspace: ws.id, email: target, role: 'admin', invitedBy: owner.id, status: 'pending', token }, owner.token), 'invite');
        const early = await api.call('POST', '/api/collections/users/records', { email: target, password: 'Passw0rd!2345', passwordConfirm: 'Passw0rd!2345', name: 'early' });
        allowed(early, 'someone registers the invited address first');
        const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: target, password: 'Passw0rd!2345' }), 'sign in');
        const noLink = await api.must(api.call('POST', '/api/waypoint/invites/claim', {}, auth.token), 'claim without the link');
        ok(noLink.workspaces.length === 0, 'an unverified account was seated without the invite link');
        const seated = await api.list('workspace_members', owner.token, `&filter=${encodeURIComponent(`user="${auth.record.id}"`)}`);
        ok(seated.length === 0, 'signing up or signing in seated an unverified account');
        const wrong = await api.must(api.call('POST', '/api/waypoint/invites/claim', { token }, squatter.token), 'link used by another account');
        ok(wrong.workspaces.length === 0 && wrong.reason === 'other-email', `a forwarded link seated another account (${JSON.stringify(wrong)})`);
        const right = await api.must(api.call('POST', '/api/waypoint/invites/claim', { token }, auth.token), 'link used by the invited address');
        ok(right.workspaces.includes(ws.id), 'the link did not seat the invited address');
        const again = await api.must(api.call('POST', '/api/waypoint/invites/claim', { token }, auth.token), 'link used twice');
        ok(again.workspaces.length === 0, 'an invite link worked twice');
        const stored = (await api.list('workspace_invites', owner.token)).find((i) => i.email === target);
        ok(stored && !JSON.stringify(stored).includes(token), 'the invite secret is stored readable');
      });

    await check('a verified address is seated without the link',
      'Someone who proved the address is theirs should not have to dig out the email.',
      async () => {
        const known = await api.signup('known');
        const admin = client(pb.url);
        allowed(await admin.call('PATCH', `/api/collections/users/records/${known.id}`, { verified: true }, pb.adminToken), 'mark verified');
        await api.must(api.create('workspace_invites', { workspace: ws.id, email: known.email, role: 'editor', invitedBy: owner.id, status: 'pending', token: api.inviteToken() }, owner.token), 'invite');
        await api.must(api.call('POST', '/api/waypoint/invites/claim', {}, known.token), 'claim');
        const seated = await api.list('workspace_members', known.token, `&filter=${encodeURIComponent(`user="${known.id}" && workspace="${ws.id}"`)}`);
        ok(seated.length === 1, 'a verified invitee was not seated');
      });

    await check('a viewer can read but not change anything',
      'The viewer role was only a label: every write rule checked membership, not role, so a viewer could edit, delete pages and wipe backups straight through the API.',
      async () => {
        const t = await api.must(api.create('tables', { name: 'vt', workspace: ws.id }, owner.token), 'table');
        const r = await api.must(api.create('table_rows', { table: t.id, workspace: ws.id, cells: {} }, owner.token), 'row');
        const v = await api.must(api.create('page_versions', { page: page.id, workspace: ws.id, content: '{}' }, owner.token), 'version');
        ok((await api.list('pages', viewer.token)).some((p) => p.id === page.id), 'the viewer cannot read the page');
        ok((await api.list('table_rows', viewer.token)).some((x) => x.id === r.id), 'the viewer cannot read the row');
        refused(await api.create('pages', { title: 'v', workspace: ws.id, owner: viewer.id }, viewer.token), 'viewer creates a page');
        refused(await api.update('pages', page.id, { title: 'viewer was here' }, viewer.token), 'viewer edits a page');
        refused(await api.remove('pages', page.id, viewer.token), 'viewer deletes a page');
        refused(await api.create('tables', { name: 'v', workspace: ws.id }, viewer.token), 'viewer creates a table');
        refused(await api.update('tables', t.id, { name: 'v' }, viewer.token), 'viewer renames a table');
        refused(await api.remove('tables', t.id, viewer.token), 'viewer deletes a table');
        refused(await api.create('table_rows', { table: t.id, workspace: ws.id, cells: {} }, viewer.token), 'viewer adds a row');
        refused(await api.update('table_rows', r.id, { cells: { a: 1 } }, viewer.token), 'viewer edits a row');
        refused(await api.remove('table_rows', r.id, viewer.token), 'viewer deletes a row');
        refused(await api.create('yupdates', { page: page.id, workspace: ws.id, data: 'AAAA' }, viewer.token), 'viewer types into a page (Yjs)');
        refused(await api.remove('page_versions', v.id, viewer.token), 'viewer deletes a backup');
        refused(await api.create('comments', { page: page.id, author: viewer.id, authorName: 'V', body: 'x' }, viewer.token), 'viewer comments');
        refused(await api.create('file_trash', { workspace: ws.id, url: '/api/files/x', name: 'x', status: 'pending' }, viewer.token), 'viewer trashes a file');
        allowed(await api.create('presence', { page: page.id, user: viewer.id, mode: 'viewing' }, viewer.token), 'viewer shows as present');
      });

    await check('being an editor somewhere else does not make you an editor here',
      'Role checks must look at the membership for this workspace, not any membership that happens to say editor.',
      async () => {
        const elsewhere = await api.workspace(viewer, 'Viewer own space');
        ok(!!elsewhere.id, 'the viewer has their own workspace as admin');
        refused(await api.update('pages', page.id, { title: 'x' }, viewer.token), 'viewer edits the owner page while admin elsewhere');
      });

    await check('someone listed as a viewer of one page cannot edit that page',
      'Page sharing lets an owner make a colleague a viewer of one page; the server let them edit it anyway.',
      async () => {
        const colleague = await api.signup('colleague');
        await api.invite(owner, ws, colleague, 'editor');
        const third = await api.signup('third');
        await api.invite(owner, ws, third, 'editor');
        const shared = await api.must(api.create('pages', { title: 'shared', workspace: ws.id, owner: owner.id, visibility: 'workspace', viewers: [third.id, colleague.id] }, owner.token), 'page with two page viewers');
        refused(await api.update('pages', shared.id, { title: 'x' }, colleague.token), 'page viewer edits');
        const promoted = await api.must(api.create('pages', { title: 'both', workspace: ws.id, owner: owner.id, visibility: 'workspace', viewers: [colleague.id], editors: [colleague.id] }, owner.token), 'page where they are an editor too');
        allowed(await api.update('pages', promoted.id, { title: 'y' }, colleague.token), 'listed as editor wins over viewer');
        const open = await api.must(api.create('pages', { title: 'open', workspace: ws.id, owner: owner.id, visibility: 'workspace' }, owner.token), 'plain page');
        allowed(await api.update('pages', open.id, { title: 'y' }, colleague.token), 'editor edits a page nobody restricted');
      });

    await check('records that belong to no workspace are readable by nobody',
      'Backups, Yjs edits and reminders with an empty workspace were readable and deletable by any signed-in account.',
      async () => {
        const admin = client(pb.url);
        const orphanUpdate = await admin.must(admin.create('yupdates', { page: page.id, workspace: '', data: 'AAAA' }, pb.adminToken), 'orphan yupdate');
        const orphanVersion = await admin.must(admin.create('page_versions', { page: page.id, workspace: '', content: '{"secret":1}' }, pb.adminToken), 'orphan version');
        const orphanReminder = await admin.must(admin.create('reminders', { workspace: '', fireAt: '2030-01-01T00:00', target: 'x', recipients: [] }, pb.adminToken), 'orphan reminder');
        ok(!(await api.list('yupdates', outsider.token)).some((x) => x.id === orphanUpdate.id), 'an outsider lists an orphan Yjs update');
        ok(!(await api.list('page_versions', outsider.token)).some((x) => x.id === orphanVersion.id), 'an outsider lists an orphan backup');
        ok(!(await api.list('reminders', outsider.token)).some((x) => x.id === orphanReminder.id), 'an outsider lists an orphan reminder');
        refused(await api.remove('page_versions', orphanVersion.id, outsider.token), 'outsider deletes an orphan backup');
        refused(await api.remove('yupdates', orphanUpdate.id, outsider.token), 'outsider deletes an orphan Yjs update');
      });

    await check('everything the app does day to day is still allowed',
      'A rule that is too tight breaks the app for everyone, silently: the write fails and the change is lost on reload.',
      async () => {
        const member = await api.signup('member');
        const m = await api.invite(owner, ws, member, 'editor');
        allowed(await api.update('workspace_members', m.id, { role: 'viewer' }, owner.token), 'owner changes a role');
        refused(await api.create('pages', { title: 'm', workspace: ws.id, owner: member.id }, member.token), 'a member just made viewer creates a page');
        allowed(await api.update('workspace_members', m.id, { role: 'editor' }, owner.token), 'owner changes it back');
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
