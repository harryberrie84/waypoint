import { startApp, registerInUi, pickStarter, waitFor } from '../harness/browser.mjs';
import { suite, check, eq } from '../harness/runner.mjs';

export default async function () {
  suite('browser: the to-dos starter opens with its checklist');
  const app = await startApp();
  try {
    const page = await app.newPage('me');
    await registerInUi(page, app.pb.url, 'me');
    await pickStarter(page, 'to-dos');

    await check('the to-dos page shows three empty checkboxes ready to type in',
      'Its items were built with empty text, which the editor refuses, so the first page a new account picked opened blank.',
      async () => {
        await waitFor(async () => (await page.locator('.ProseMirror ul[data-type="taskList"] > li').count()) === 3, 'three checklist items');
        await page.locator('.ProseMirror ul[data-type="taskList"] > li p').first().click();
        await page.keyboard.type('call the ferry');
        await waitFor(async () => (await page.locator('.ProseMirror ul[data-type="taskList"] > li').first().innerText()).includes('call the ferry'), 'typing into the first item');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A crash here is the first thing a new account sees.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
