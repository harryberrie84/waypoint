import { startApp, registerInUi, pickStarter, waitFor } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: Escape closes what is open');
  const app = await startApp();
  try {
    const page = await app.newPage('esc');
    await registerInUi(page, app.pb.url, 'esc');
    await pickStarter(page, 'blank page');
    await page.locator('.ProseMirror').first().waitFor();
    const gone = (locator, what) => waitFor(async () => (await locator.count()) === 0, what, 3000);

    await check('Escape closes Settings, Appearance and the trash',
      'Every other panel in the app closes on Escape; these ignored it and had to be clicked shut.',
      async () => {
        await page.getByRole('button', { name: /Settings/ }).first().click();
        const settings = page.getByRole('button', { name: 'Members', exact: true });
        await settings.first().waitFor();
        await page.keyboard.press('Escape');
        await gone(settings, 'Settings closed');

        await page.getByTitle('Appearance').first().click();
        const appearance = page.getByText('Appearance', { exact: true }).locator('xpath=ancestor::div[contains(@class,"fixed")]');
        await appearance.first().waitFor();
        await page.keyboard.press('Escape');
        await gone(appearance, 'Appearance closed');

        await page.getByRole('button', { name: /Trash/ }).first().click();
        const trash = page.getByText('Clear trash');
        await page.waitForTimeout(300);
        const trashOpen = await page.locator('div.fixed').filter({ hasText: /Trash/ }).count();
        ok(trashOpen > 0, 'the trash opened');
        await page.keyboard.press('Escape');
        await waitFor(async () => (await page.locator('div.fixed').filter({ hasText: /Trash/ }).count()) < trashOpen, 'the trash closed', 3000);
        eq(await trash.count(), 0, 'nothing of the trash is left showing');
      });

    await check('Escape closes the page icon picker',
      'The picker stayed open over the page until something was chosen or clicked away.',
      async () => {
        await page.locator('main button.shrink-0.rounded-xl').first().click();
        const picker = page.getByText('Upload an image');
        await picker.first().waitFor();
        await page.keyboard.press('Escape');
        await gone(picker, 'the picker closed');
      });

    await check('with a picker open inside Settings, Escape closes the picker first, then Settings',
      'One Escape should close one thing, the one on top, not everything at once.',
      async () => {
        await page.getByRole('button', { name: /Settings/ }).first().click();
        await page.getByRole('button', { name: 'Workspace', exact: true }).first().click();
        await page.getByTitle('Change workspace icon').click();
        const picker = page.getByText('Upload an image');
        await picker.first().waitFor();
        await page.keyboard.press('Escape');
        await gone(picker, 'the picker closed');
        ok((await page.getByRole('button', { name: 'Members', exact: true }).count()) > 0, 'Settings is still open after the first Escape');
        await page.keyboard.press('Escape');
        await gone(page.getByRole('button', { name: 'Members', exact: true }), 'Settings closed on the second Escape');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A panel that throws on close takes the page with it.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
