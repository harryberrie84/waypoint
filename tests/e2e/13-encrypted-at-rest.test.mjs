import { startApp, registerInUi, pickStarter, waitFor, settled } from '../harness/browser.mjs';
import { suite, check, ok, eq } from '../harness/runner.mjs';

async function localScan(page, needles) {
  return page.evaluate(async (needles) => {
    const dbs = (await indexedDB.databases()).map((d) => d.name).filter((n) => n && /^wp-(page|sealed)-/.test(n));
    const found = {};
    const names = [];
    for (const name of dbs) {
      names.push(name);
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const storeName of [...db.objectStoreNames]) {
        const values = await new Promise((res) => {
          const out = [];
          const req = db.transaction(storeName, 'readonly').objectStore(storeName).openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (!c) return res(out);
            out.push(c.value);
            c.continue();
          };
          req.onerror = () => res(out);
        });
        for (const v of values) {
          if (name.startsWith('wp-sealed-') && !(typeof v === 'string' && v.startsWith('enc:'))) found.__notCiphertext = [...(found.__notCiphertext || []), name];
          const text = typeof v === 'string' ? v : v instanceof Uint8Array ? new TextDecoder('latin1').decode(v) : JSON.stringify(v);
          for (const n of needles) if (text.includes(n)) found[n] = [...(found[n] || []), name];
        }
      }
      db.close();
    }
    return { names, found };
  }, needles);
}

export default async function () {
  suite('browser: encrypted pages on this device');
  const app = await startApp();
  const url = app.pb.url;
  try {
    const page = await app.newPage('owner');
    const me = await registerInUi(page, url, 'cipher');
    await pickStarter(page, 'blank page');
    await page.locator('main input').first().fill('Diary');
    const before = `plain-before-${Date.now()}`;
    await page.locator('.ProseMirror[contenteditable="true"]').first().click();
    await page.keyboard.type(before);
    await page.waitForTimeout(2500);

    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.getByRole('button', { name: 'Workspace', exact: true }).first().click();
    await page.getByTitle('turn encryption on').click();
    await page.getByRole('button', { name: /encrypt existing pages now/ }).click();
    await page.getByPlaceholder('your account password').fill(me.password);
    await page.getByRole('button', { name: 'set up vault' }).click();
    await page.waitForTimeout(1500);
    for (const label of ['done', 'Done', "I've saved it", 'close']) {
      const b = page.getByRole('button', { name: label, exact: true });
      if (await b.count()) await b.first().click().catch(() => {});
    }
    await page.keyboard.press('Escape');
    const again = page.getByRole('button', { name: /encrypt existing pages now/ });
    if (await again.count()) await again.first().click().catch(() => {});
    await page.waitForTimeout(3000);
    await page.keyboard.press('Escape');

    await check('an encrypted page is not kept readable on this device',
      'Opening a page in an encrypted workspace used to leave its full text in the browser’s storage, readable by anything that can read the disk or run in the page, even after signing out.',
      async () => {
        await page.reload();
        await page.locator('.ProseMirror[contenteditable="true"]').first().waitFor({ timeout: 20000 });
        await settled(page, '.ProseMirror[contenteditable="true"]');
        await waitFor(async () => (await page.locator('.ProseMirror').first().innerText()).includes(before), 'the earlier text still on the page', 15000);
        const after = `sealed-after-${Date.now()}`;
        await page.locator('.ProseMirror[contenteditable="true"]').first().click();
        await page.keyboard.press('Control+End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(after);
        await page.waitForTimeout(3000);
        const scan = await localScan(page, [before, after]);
        ok(scan.names.some((n) => n.startsWith('wp-sealed-')), `no sealed copy was written (${scan.names.join(', ')})`);
        eq(scan.names.filter((n) => n.startsWith('wp-page-')), [], 'a readable copy of the encrypted page is still on this device');
        eq(scan.found, {}, 'plain text of the encrypted page found in local storage');
        page.__after = after;
      });

    await check('what was typed while the server could not be reached is still there after a reload',
      'The local copy is what saves edits the server has not received yet; sealing it must not make it lose them.',
      async () => {
        const offline = `unsent-${Date.now()}`;
        await page.route(/\/api\/collections\/(yupdates|pages)\/records/, (route) => (route.request().method() === 'GET' ? route.continue() : route.abort()));
        await page.locator('.ProseMirror[contenteditable="true"]').first().click();
        await page.keyboard.press('Control+End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(offline);
        await page.waitForTimeout(2000);
        await page.reload();
        await page.unroute(/\/api\/collections\/(yupdates|pages)\/records/);
        await page.locator('.ProseMirror').first().waitFor({ timeout: 20000 });
        await waitFor(async () => (await page.locator('.ProseMirror').first().innerText()).includes(offline), 'the unsent text after a reload', 20000);
        const scan = await localScan(page, [offline]);
        eq(scan.names.filter((n) => n.startsWith('wp-page-')), [], 'a readable copy of the encrypted page is on this device');
        eq(scan.found, {}, 'the unsent text sits in local storage as plain text');
      });
  } finally {
    await app.stop();
  }
}
