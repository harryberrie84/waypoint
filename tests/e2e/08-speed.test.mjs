import { startApp, signInInUi, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, ok } from '../harness/runner.mjs';

const PAGES = 300;
const doc = (k) => ({ type: 'doc', content: Array.from({ length: 40 }, (_, j) => ({ type: 'paragraph', content: [{ type: 'text', text: `line ${j} of version ${k}, about the ferry, the hostel and the budget` }] })) });

export default async function () {
  suite('browser: stays quick in a busy workspace');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const me = await api.signup('me');
    const ws = await api.workspace(me);
    const colleagues = [];
    for (let i = 0; i < 3; i++) {
      const c = await api.signup(`colleague${i}`);
      await api.invite(me, ws, c, 'editor');
      colleagues.push(c);
    }
    const snapshot = Buffer.alloc(30000, 7).toString('base64');
    const pages = [];
    let next = 0;
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (next < PAGES) {
        const k = next++;
        // By number, not by finishing order: the creates run in parallel, and the
        // colleagues below must type into pages 50 to 52, never into one checked later.
        pages[k] = (await api.must(api.create('pages', { title: `Page ${k}`, workspace: ws.id, owner: me.id, order: k, parent: '', content: doc(k), ydoc: snapshot }, me.token), 'page'));
      }
    }));

    const page = await app.newPage('me');
    let listBytes = 0;
    let listHasSnapshot = false;
    page.on('response', async (r) => {
      if (/\/api\/collections\/pages\/records\?/.test(r.url())) {
        try {
          const body = await r.text();
          listBytes += body.length;
          if (body.includes('"ydoc"')) listHasSnapshot = true;
        } catch {
          listBytes += 0;
        }
      }
    });
    await page.addInitScript(() => {
      window.__long = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
    });
    await signInInUi(page, url, me.email);
    await sidebar(page).getByText('Page 10', { exact: true }).first().waitFor({ timeout: 30000 });

    await check('signing in does not download every page’s Yjs snapshot',
      'The snapshot is only for the editor, which fetches its own. In the list it was 80% of the sign-in download, seconds on a home connection.',
      async () => {
        ok(!listHasSnapshot, 'a pages list response carried ydoc');
        ok(listBytes < PAGES * 12000, `pages list was ${listBytes} bytes for ${PAGES} pages`);
      });

    await check("colleagues typing on other pages do not make your screen stutter",
      'Each of their saves reaches every member. The sidebar used to redraw every row and rescan every page for each one, which blocked typing in 50-70 ms chunks.',
      async () => {
        await sidebar(page).getByText('Page 5', { exact: true }).first().click();
        await page.locator('.ProseMirror').first().waitFor();
        await page.waitForTimeout(1500);
        await page.evaluate(() => { window.__long = []; });
        let stop = false;
        const typing = colleagues.map((c, i) => (async () => {
          let k = 0;
          while (!stop) {
            await api.update('pages', pages[50 + i].id, { content: doc(1000 + k++) }, c.token);
            await new Promise((r) => setTimeout(r, 1000));
          }
        })());
        await page.waitForTimeout(8000);
        stop = true;
        await Promise.all(typing);
        const long = await page.evaluate(() => window.__long);
        const total = long.reduce((a, b) => a + b, 0);
        ok(total < 600, `main thread blocked ${Math.round(total)} ms in 8 s (${long.length} long tasks: ${long.map(Math.round).join(', ')})`);
      });

    await check('opening a page is quick',
      'Switching pages is the most frequent action in the app.',
      async () => {
        const times = [];
        for (const n of [20, 40, 60]) {
          const t0 = Date.now();
          await sidebar(page).getByText(`Page ${n}`, { exact: true }).first().click();
          try {
            await waitFor(async () => (await page.locator('.ProseMirror').first().innerText()).includes(`version ${n},`), `Page ${n} text`);
          } catch (e) {
            const shown = (await page.locator('.ProseMirror').first().innerText().catch(() => '')).slice(0, 80);
            const title = await page.locator('main input').first().inputValue().catch(() => '');
            throw new Error(`${e.message}; the title reads "${title}" and the editor shows "${shown}"`);
          }
          times.push(Date.now() - t0);
        }
        ok(Math.max(...times) < 2500, `page switches took ${times.join(', ')} ms`);
      });
  } finally {
    await app.stop();
  }
}
