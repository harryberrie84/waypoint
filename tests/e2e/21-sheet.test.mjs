import { startApp, signInInUi, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq } from '../harness/runner.mjs';

export default async function () {
  suite('browser: typing into the spreadsheet keeps every keystroke');
  const app = await startApp();
  const url = app.pb.url;
  const api = client(url);
  try {
    const me = await api.signup('me');
    const ws = await api.workspace(me);
    const pg = await api.must(api.create('pages', { title: 'Costs', workspace: ws.id, owner: me.id, parent: '', defaultTab: 'sheet' }, me.token), 'page');

    const page = await app.newPage('me');
    await signInInUi(page, url, me.email);
    await sidebar(page).getByText('Costs', { exact: true }).first().click();
    const grid = page.locator('[tabindex="0"]').filter({ has: page.locator('table') }).first();
    await grid.waitFor({ timeout: 15000 });
    const cells = async () => (await api.get('pages', pg.id, me.token)).data.sheet?.cells ?? {};

    await check('the first character typed into a cell is kept',
      'Typing started the edit with that character selected, so the second keystroke replaced it: "hello" became "ello".',
      async () => {
        await page.locator('tbody td').first().click();
        await page.keyboard.type('hello');
        await page.keyboard.press('Enter');
        await waitFor(async () => (await cells()).A1 === 'hello', 'A1 = hello on the server');
      });

    await check('after Enter and Tab the keyboard keeps working in the grid',
      'Committing a cell removed the input that had focus, so the next keys went nowhere until the grid was clicked again.',
      async () => {
        await page.keyboard.type('42');
        await page.keyboard.press('Tab');
        await page.keyboard.type('x');
        await page.keyboard.press('Escape');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.type('7');
        await page.keyboard.press('Enter');
        await waitFor(async () => (await cells()).A2 === '7', 'A2 = 7 after Tab, Escape, ArrowLeft and typing', 8000);
        eq((await cells()).A1, 'hello', 'A1 unchanged');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused sheet save would show the numbers locally and lose them on reload.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
