import { startPocketBase } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, ok, eq } from '../harness/runner.mjs';

const refused = (r, what) => ok(r.status >= 400 && r.status < 500, `${what}: expected a refusal, got ${r.status} ${r.text.slice(0, 200)}`);
const allowed = (r, what) => ok(r.status === 200, `${what}: expected 200, got ${r.status} ${r.text.slice(0, 200)}`);

export default async function () {
  suite('guards: uploads, workspace keys and reminders');
  const pb = await startPocketBase();
  const api = client(pb.url);
  const upload = async (who, name, type, body, workspace) => {
    const fd = new FormData();
    fd.append('file', new Blob([body], { type }), name);
    if (workspace) fd.append('workspace', workspace);
    const r = await fetch(`${pb.url}/api/collections/uploads/records`, { method: 'POST', headers: { Authorization: who.token }, body: fd });
    return { status: r.status, text: await r.text() };
  };
  try {
    const owner = await api.signup('owner');
    const ws = await api.workspace(owner);
    const ed = await api.signup('ed');
    await api.invite(owner, ws, ed, 'editor');
    const viewer = await api.signup('viewer');
    await api.invite(owner, ws, viewer, 'viewer');
    const newbie = await api.signup('newbie');
    await api.invite(owner, ws, newbie, 'editor');
    const outsider = await api.signup('outsider');

    await check('only someone who can edit a workspace uploads into it',
      'An upload with no workspace was allowed for any account, so anyone signed in could store files on this server.',
      async () => {
        refused(await upload(outsider, 'a.pdf', 'application/pdf', '%PDF', ''), 'an upload with no workspace');
        refused(await upload(outsider, 'a.pdf', 'application/pdf', '%PDF', ws.id), 'an outsider uploads into the workspace');
        refused(await upload(viewer, 'a.pdf', 'application/pdf', '%PDF', ws.id), 'a viewer uploads');
        allowed(await upload(ed, 'plan.pdf', 'application/pdf', '%PDF', ws.id), 'an editor uploads a document');
        allowed(await upload(ed, 'photo.png', 'image/png', 'png', ws.id), 'an editor uploads a picture');
      });

    await check('files a browser would run as a page or a script are refused',
      'Served from this server, a page or script could act as the signed-in person. The app never uploads one.',
      async () => {
        refused(await upload(ed, 'x.html', 'text/html', '<script>1</script>', ws.id), 'an HTML page');
        refused(await upload(ed, 'x.HTM', 'text/html', '<script>1</script>', ws.id), 'an HTML page with an upper-case name');
        refused(await upload(ed, 'x.svg', 'image/svg+xml', '<svg/>', ws.id), 'an SVG');
        refused(await upload(ed, 'x.js', 'text/javascript', 'alert(1)', ws.id), 'a script');
        refused(await upload(ed, 'x.xml', 'application/xml', '<a/>', ws.id), 'an XML file');
      });

    await check('deleting a file for good makes its link stop working',
      'Upload links are long and unguessable but never expire. If one leaks, deleting the file (and uploading it again if it is still needed) is how its old link is shut.',
      async () => {
        const fd = new FormData();
        fd.append('file', new Blob(['secret plans'], { type: 'application/pdf' }), 'plans.pdf');
        fd.append('workspace', ws.id);
        const r = await fetch(`${pb.url}/api/collections/uploads/records`, { method: 'POST', headers: { Authorization: ed.token }, body: fd });
        const rec = await r.json();
        const link = `${pb.url}/api/files/${rec.collectionId}/${rec.id}/${rec.file}`;
        eq((await fetch(link)).status, 200, 'the link works while the file exists');
        eq((await api.call('DELETE', `/api/collections/uploads/records/${rec.id}`, undefined, ed.token)).status, 204, 'an editor deletes the file');
        eq((await fetch(link)).status, 404, 'the old link after the delete');
      });

    await check('a workspace key is planted only by someone who holds it and can edit',
      'A key row someone else made for you is the key you encrypt with. A viewer, or a member without the key, could hand a newcomer a key of their own.',
      async () => {
        const key = (user, by) => api.call('POST', '/api/collections/workspace_keys/records', { workspace: ws.id, user: user.id, wrappedKey: `wrapped-for-${user.name}-by-${by.name}` }, by.token);
        allowed(await key(owner, owner), 'the owner stores their own key');
        refused(await key(newbie, viewer), 'a viewer plants a key for a member');
        refused(await key(newbie, ed), 'an editor who does not hold the key plants one');
        refused(await key(outsider, owner), 'a key for someone outside the workspace');
        allowed(await key(ed, owner), 'the key holder grants an editor');
        allowed(await key(newbie, ed), 'an editor who now holds the key grants a member');
        allowed(await key(viewer, viewer), 'a viewer stores their own key');
      });

    await check('a reminder only goes to members of its workspace',
      'The server emails whoever a reminder lists. Listing any account turned the server into a way to mail strangers.',
      async () => {
        const remind = (recipients) => api.call('POST', '/api/collections/reminders/records', { workspace: ws.id, fireAt: '2030-01-01T09:00:00Z', target: '2030-01-01T10:00:00Z', recipients }, ed.token);
        refused(await remind([outsider.id]), 'a reminder to an outsider');
        refused(await remind([ed.id, outsider.id]), 'a reminder to a member and an outsider');
        const r = await remind([ed.id, viewer.id]);
        allowed(r, 'a reminder to members');
        refused(await api.call('PATCH', `/api/collections/reminders/records/${r.data.id}`, { recipients: [outsider.id] }, ed.token), 'changing a reminder to an outsider');
        allowed(await api.call('PATCH', `/api/collections/reminders/records/${r.data.id}`, { recipients: [owner.id] }, ed.token), 'changing it to another member');
      });
  } finally {
    await pb.stop();
  }
}
