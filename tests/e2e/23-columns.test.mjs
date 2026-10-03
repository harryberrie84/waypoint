import { startApp, registerInUi, pickStarter, waitFor } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const menu = (page, text) => page.locator('div[style*="z-index: 1300"] button').filter({ hasText: text }).first();

export default async function () {
  suite('browser: columns sit side by side on a desktop screen');
  const app = await startApp();
  try {
    const page = await app.newPage('me');
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerInUi(page, app.pb.url, 'me');
    await pickStarter(page, 'blank page');
    const ed = page.locator('.ProseMirror[contenteditable="true"]').first();
    await ed.click();
    await page.keyboard.type('/columns');
    await menu(page, 'Two side-by-side sections').click();
    await waitFor(async () => (await page.locator('.col-row .tiptap-column').count()) === 2, 'two columns');

    await check('two columns each take about half the row, next to each other',
      'The layout rule sat on an element the editor wraps, so the columns shrank to their text and bunched up on the left.',
      async () => {
        const boxes = await page.locator('.col-row .tiptap-column').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width })));
        const row = await page.locator('.col-row').first().evaluate((e) => e.getBoundingClientRect().width);
        eq(Math.round(boxes[0].y), Math.round(boxes[1].y), 'both columns on one line');
        ok(boxes[1].x > boxes[0].x, 'second column to the right of the first');
        for (const b of boxes) ok(b.w > row * 0.4 && b.w < row * 0.6, `a column is ${Math.round(b.w)}px of a ${Math.round(row)}px row`);
      });

    await check('typing in the second column stays in that column',
      'A column that collapses to nothing cannot be clicked into.',
      async () => {
        await page.locator('.col-row .tiptap-column').nth(1).locator('p').first().click();
        await page.keyboard.type('right side');
        ok((await page.locator('.col-row .tiptap-column').nth(1).innerText()).includes('right side'), 'the text went elsewhere');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A crash while laying out columns would blank the page.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
