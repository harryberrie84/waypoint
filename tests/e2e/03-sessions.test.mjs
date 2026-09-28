import { startApp, registerInUi, pickStarter, sidebarText, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: sessions on a shared computer');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  const signedIn = async (p) => (await p.getByTitle('Sign out').count()) > 0;
  try {
    await check('signing out reloads the page and leaves no session behind',
      'On a shared computer the next person must not inherit the last one’s session, keys or cached workspace.',
      async () => {
        const page = await app.newPage('shared computer');
        await registerInUi(page, url, 'first');
        await pickStarter(page, 'a trip');
        let navigations = 0;
        page.on('framenavigated', (f) => f === page.mainFrame() && navigations++);
        await page.getByTitle('Sign out').click();
        await waitFor(async () => !(await signedIn(page)) && navigations > 0, 'the sign-in screen after a reload');
        const auth = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('pocketbase_auth') || k.startsWith('waypoint:vault')));
        eq(auth, [], 'session or key cache left in storage');
        await registerInUi(page, url, 'second');
        await page.waitForTimeout(1500);
        ok(!(await sidebarText(page)).includes('Trip'), "the next person sees the previous person's page");
      });

    await check('a session the server rejects signs out cleanly instead of pretending',
      'After a password change, a removed account or a restored backup, a dead session that looks alive silently fails every save.',
      async () => {
        const page = await app.newPage('rejected');
        const who = await registerInUi(page, url, 'doomed');
        const found = await api.list('users', app.pb.adminToken, `&filter=${encodeURIComponent(`email="${who.email}"`)}`);
        await api.must(api.remove('users', found[0].id, app.pb.adminToken), 'remove the account');
        await page.reload();
        await waitFor(async () => (await page.getByPlaceholder('you@example.com').count()) > 0, 'the sign-in screen', 15000);
        const auth = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('pocketbase_auth')));
        eq(auth, [], 'dead session left in storage');
      });

    await check('signing out in one tab signs out the other tabs too',
      'Otherwise a tab left open keeps an unlocked vault and a workspace on screen after its owner walked away.',
      async () => {
        const first = await app.newPage('tab one');
        await registerInUi(first, url, 'tabs');
        await pickStarter(first, 'blank page');
        const second = await first.context().newPage();
        app.watch(second, 'tab two');
        await second.goto(url + '/');
        await waitFor(() => signedIn(second), 'the second tab signed in');
        await second.getByTitle('Sign out').click();
        await waitFor(async () => !(await signedIn(first)), 'the first tab signed out', 15000);
      });

    await check('nothing along the way was refused by the server, apart from the removed account',
      'A refused request in these flows means a session or key step silently failed.',
      async () => eq(app.problems.filter((p) => !p.startsWith('rejected')), [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
