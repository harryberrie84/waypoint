import { startApp, registerInUi, pickStarter, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: edits made offline wait in the tab and go out on reconnect');
  const app = await startApp();
  const api = client(app.pb.url);
  try {
    const page = await app.newPage('me');
    await registerInUi(page, app.pb.url, 'me');
    await pickStarter(page, 'blank page');
    await page.locator('main input').first().fill('Before');
    await waitFor(async () => (await sidebar(page).innerText()).includes('Before'), 'the title saved');
    await page.waitForTimeout(1200);
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('pocketbase_auth') || '{}').token);
    const titles = async () => (await api.list('pages', token)).map((p) => p.title);

    await check('an offline rename is counted in the banner, and the banner says it is only held in this tab',
      'The queue lives in memory. Saying edits "stay on this device" would promise something a closed tab breaks.',
      async () => {
        await page.context().setOffline(true);
        await page.locator('main input').first().fill('Renamed offline');
        const banner = page.getByText("You're offline.", { exact: false }).first();
        await banner.waitFor({ timeout: 5000 });
        await waitFor(async () => /1 waiting/.test(await banner.innerText()), 'the waiting count');
        ok(/close the tab first and they are lost/.test(await banner.innerText()), 'the banner does not say the edits are lost with the tab');
        ok(!(await titles()).includes('Renamed offline'), 'the rename reached the server while offline');
      });

    await check('back online, the held rename reaches the server and the banner goes',
      'A held edit that never goes out is a lost edit.',
      async () => {
        await page.context().setOffline(false);
        await waitFor(async () => (await titles()).includes('Renamed offline'), 'the rename on the server', 15000);
        await waitFor(async () => (await page.getByText("You're offline.", { exact: false }).count()) === 0, 'the banner gone');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused replay would be silent.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
