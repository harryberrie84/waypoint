import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startApp, buildApp, registerInUi, pickStarter } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

// The main file every visit downloads before anything shows. It was 2.9 MB with
// the maps, the video converter and every page tab in it.
const MAIN_BUDGET = 1600 * 1024;

export default async function () {
  suite('browser: what loads first, and what loads later');
  const dist = buildApp();
  const app = await startApp();
  try {
    await check('the file every visit downloads first stays small',
      'Everything in it is downloaded and run before the first page shows, on every visit and every phone.',
      async () => {
        const assets = join(dist, 'assets');
        const main = readdirSync(assets).filter((f) => /^index-.*\.js$/.test(f)).map((f) => statSync(join(assets, f)).size);
        ok(main.length > 0, 'the main file was found');
        const size = Math.max(...main);
        ok(size < MAIN_BUDGET, `the main file is ${Math.round(size / 1024)} KB, over the ${MAIN_BUDGET / 1024} KB budget`);
      });

    await check('a tab never opened before still opens with no connection',
      'Tabs now load when first opened. The app fetches them in the background once it has started, so going offline does not leave a tab that cannot open.',
      async () => {
        const page = await app.newPage('loads');
        await registerInUi(page, app.pb.url, 'loads');
        await pickStarter(page, 'a trip');
        await page.waitForTimeout(8000);
        await page.context().setOffline(true);
        for (const tab of ['Calendar', 'Map', 'Kanban']) {
          await page.getByRole('button', { name: tab, exact: true }).first().click();
          await page.waitForTimeout(2000);
          const text = await page.locator('main').innerText();
          ok(!/loading…|unexpected error|went wrong/i.test(text), `the ${tab} tab offline shows: ${text.slice(0, 120)}`);
        }
        await page.context().setOffline(false);
      });

    await check('nothing along the way was refused by the server or crashed',
      'A tab that fails to load is a blank page.',
      async () => eq(app.problems.filter((p) => !/Something went wrong/.test(p)), [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
