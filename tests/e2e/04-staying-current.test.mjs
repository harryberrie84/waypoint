import { startApp, registerInUi, pickStarter, sidebarText, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq } from '../harness/runner.mjs';

export default async function () {
  suite('browser: staying current without reloading everything');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const page = await app.newPage('user');
    const full = { n: 0 };
    page.on('request', (r) => {
      if (r.method() === 'GET' && /\/api\/collections\/(pages|tables|table_rows)\/records\?/.test(r.url()) && !/filter=/.test(decodeURIComponent(r.url()))) full.n++;
    });
    const who = await registerInUi(page, url, 'current');
    await pickStarter(page, 'a trip');
    await page.waitForTimeout(1500);
    const setVisibility = (v) => page.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      Object.defineProperty(document, 'hidden', { value: v === 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, v);

    await check('switching windows or glancing at another tab does not download the workspace again',
      'Every such reload downloaded every page, table and row; with a real workspace that is seconds of waiting and megabytes each time someone alt-tabs.',
      async () => {
        const before = full.n;
        for (let i = 0; i < 4; i++) {
          await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
          await page.waitForTimeout(2200);
        }
        await setVisibility('hidden');
        await page.waitForTimeout(800);
        await setVisibility('visible');
        await page.waitForTimeout(2500);
        eq(full.n - before, 0, 'full downloads');
      });

    await check('coming back after a long absence, or back online, does reload',
      'After a real gap the realtime stream may have died; a resync is how the page catches up.',
      async () => {
        let before = full.n;
        await setVisibility('hidden');
        await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 31_000; });
        await setVisibility('visible');
        await waitFor(async () => full.n > before, 'a resync after 31 s away');
        await page.waitForTimeout(2500);
        before = full.n;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await waitFor(async () => full.n > before, 'a resync when the network returns');
      });

    await check('a change made while the stream was down appears once it reconnects, without a full reload',
      'The stream drops on every deploy and every network blip; changes in the gap must still arrive.',
      async () => {
        const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: who.email, password: who.password }), 'token');
        const trip = (await api.list('pages', auth.token)).find((p) => p.title === 'Trip');
        await page.route('**/api/realtime**', (r) => r.abort());
        await app.pb.restart();
        const before = full.n;
        await api.must(api.update('pages', trip.id, { title: 'Renamed while away' }, auth.token), 'rename while the stream is down');
        await page.waitForTimeout(1000);
        await page.unroute('**/api/realtime**');
        await waitFor(async () => (await sidebarText(page)).includes('Renamed while away'), 'the rename after reconnecting', 20000);
        eq(full.n - before, 0, 'full downloads to catch up');
      });
  } finally {
    await app.stop();
  }
}
