import { startApp, registerInUi, pickStarter } from '../harness/browser.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('browser: paste keeps what was copied');
  const app = await startApp();
  try {
    const page = await app.newPage('me');
    await registerInUi(page, app.pb.url, 'me');
    await pickStarter(page, 'blank page');
    const ed = page.locator('.ProseMirror[contenteditable="true"]').first();

    const paste = async (data) => {
      await ed.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.evaluate((d) => {
        const dt = new DataTransfer();
        for (const [type, value] of Object.entries(d)) dt.setData(type, value);
        const target = document.querySelector('.ProseMirror[contenteditable="true"]');
        target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, data);
      await page.waitForTimeout(300);
    };
    const html = () => ed.innerHTML();

    await check('formatted text copied from a web page or this editor keeps its bold, links and lists',
      'Paste always took the plain-text copy, so bold, links and bullet lists came in flat.',
      async () => {
        await paste({ 'text/plain': 'Ferry times\nfirst\nsecond', 'text/html': '<p><strong>Ferry</strong> <a href="https://example.org">times</a></p><ul><li>first</li><li>second</li></ul>' });
        const h = await html();
        ok(h.includes('<strong>Ferry</strong>'), 'bold lost');
        ok(/href="https:\/\/example\.org"/.test(h), 'link lost');
        ok(/<ul[^>]*>.*first.*second/s.test(h), 'list lost');
      });

    await check('lines like an address paste as lines, not as a code block',
      'Any multi-line text without blank lines became a code block, so an address or a list from a note came in as code.',
      async () => {
        const before = await ed.locator('pre').count();
        await paste({ 'text/plain': 'Hotel Nikko\n2-18-25 Hakata Ekimae\nFukuoka 812-0011' });
        eq(await ed.locator('pre').count(), before, 'code blocks');
        ok((await ed.innerText()).includes('2-18-25 Hakata Ekimae'), 'the address text is missing');
      });

    await check('code still pastes as a code block',
      'The fix for addresses must not turn real code into paragraphs.',
      async () => {
        const before = await ed.locator('pre').count();
        await paste({ 'text/plain': 'const a = 1;\nconsole.log(a);' });
        eq(await ed.locator('pre').count(), before + 1, 'code blocks');
      });

    await check('markdown copied from a code editor still converts, even with an HTML copy alongside',
      'Code editors put an HTML copy of the text on the clipboard; taking it would paste "# Plan" literally.',
      async () => {
        await paste({ 'text/plain': '# Plan\n- pack\n- leave', 'text/html': '<div><span># Plan</span></div><div><span>- pack</span></div><div><span>- leave</span></div>' });
        ok(/<h1[^>]*>Plan<\/h1>/.test(await html()), 'no heading made from the markdown');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A crash on paste would lose the paste and whatever was typed with it.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
