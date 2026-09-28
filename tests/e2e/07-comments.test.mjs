import { startApp, registerInUi, pickStarter, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq } from '../harness/runner.mjs';

export default async function () {
  suite('browser: comments');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const a = await app.newPage('owner');
    const b = await app.newPage('member');
    const owner = await registerInUi(a, url, 'owner');
    await pickStarter(a, 'a trip');
    const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: owner.email, password: owner.password }), 'owner token');
    const ws = (await api.list('workspaces', auth.token))[0];
    const memberEmail = `member-${Date.now()}@example.org`;
    await api.must(api.create('workspace_invites', { workspace: ws.id, email: memberEmail, role: 'editor', invitedBy: auth.record.id, status: 'pending' }, auth.token), 'invite');
    await registerInUi(b, url, 'member', memberEmail);
    await waitFor(async () => (await sidebar(b).getByText('Trip', { exact: true }).count()) > 0, "Trip in the member's sidebar", 15000);
    await sidebar(b).getByText('Trip', { exact: true }).first().click();
    await b.getByRole('button', { name: 'Comments' }).first().click();
    await b.getByPlaceholder(/Add a comment/).waitFor();

    const text = `Bring the ferry tickets ${Date.now()}`;
    await check('a comment is posted, and a colleague with the page open sees it arrive',
      'Comments are where decisions get made; one that does not arrive means someone acts on old information.',
      async () => {
        await a.getByRole('button', { name: 'Comments' }).first().click();
        const box = a.getByPlaceholder(/Add a comment/);
        await box.click();
        await box.fill(text);
        await a.keyboard.press('Enter');
        await waitFor(async () => (await a.getByText(text).count()) > 0, 'the comment in the owner’s panel');
        await waitFor(async () => (await b.getByText(text).count()) > 0, 'the comment in the member’s open panel', 15000);
      });

    await check('the comment is still there after a reload',
      'A comment that only lived in the browser that wrote it is gone for everyone else.',
      async () => {
        await b.reload();
        await b.getByTitle('Sign out').waitFor();
        await sidebar(b).getByText('Trip', { exact: true }).first().click();
        await b.getByRole('button', { name: 'Comments' }).first().click();
        await waitFor(async () => (await b.getByText(text).count()) > 0, 'the comment after a reload', 15000);
      });

    await check('nothing along the way was refused by the server',
      'A refused save is invisible in the UI and lost on reload.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
