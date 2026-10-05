import { startApp, registerInUi, signInInUi, pickStarter, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const editorText = (page) => page.evaluate(() => document.querySelector('.ProseMirror')?.editor?.getText() ?? '');
const count = (hay, needle) => hay.split(needle).length - 1;

// A new line straight after "base line". Not Ctrl+End: the page ends in a table,
// and the end of the page is inside its last cell.
async function typeAtEnd(page, text) {
  await page.locator('.ProseMirror[contenteditable="true"] > p', { hasText: 'base line' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(text, { delay: 15 });
}

export default async function () {
  suite('browser: one person offline while another edits the same page');
  const app = await startApp();
  const api = client(app.pb.url);
  try {
    const a = await app.newPage('owner');
    const owner = await registerInUi(a, app.pb.url, 'owner');
    await pickStarter(a, 'blank page');
    await a.locator('main input').first().fill('Plan');
    await waitFor(async () => (await sidebar(a).innerText()).includes('Plan'), 'the title saved');
    await a.locator('.ProseMirror').first().click();
    await a.keyboard.type('base line', { delay: 15 });
    await a.keyboard.press('Enter');
    await a.keyboard.type('/table');
    await a.locator('div[style*="z-index: 1300"] button', { hasText: 'Relational database' }).click();
    await a.getByText('New row').first().waitFor();
    const nameCell = (p) => p.locator('table tbody tr').first().locator('input').first();
    const amountCell = (p) => p.locator('table tbody tr').first().locator('input[inputmode=decimal]');
    await nameCell(a).fill('Ferry');
    await a.keyboard.press('Tab');
    await a.waitForTimeout(2000);

    const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: owner.email, password: owner.password }), 'owner token');
    const ws = (await api.list('workspaces', auth.token))[0];
    const member = await api.signup('member');
    await api.invite({ id: auth.record.id, token: auth.token }, ws, member);
    const b = await app.newPage('member');
    await signInInUi(b, app.pb.url, member.email);
    await sidebar(b).getByText('Plan', { exact: true }).first().click();
    await waitFor(async () => (await editorText(b)).includes('base line'), "the owner's page on the member's screen", 20000);
    await b.locator('.ProseMirror[contenteditable="true"]').waitFor({ timeout: 15000 });
    await waitFor(async () => (await nameCell(b).inputValue()) === 'Ferry', 'the table on the member screen', 15000);

    const fromA = 'written offline by the owner';
    const fromB = 'written online by the member';

    await check('text both people write while one is offline ends up on both screens, once each',
      'Merging offline typing is where text gets lost or doubled. Neither is acceptable.',
      async () => {
        await a.context().setOffline(true);
        await a.waitForTimeout(500);
        await typeAtEnd(a, fromA);
        await typeAtEnd(b, fromB);
        await b.waitForTimeout(1500);
        ok(!(await editorText(b)).includes(fromA), 'the offline words reached the other screen while offline');
        await a.context().setOffline(false);
        for (const [p, who] of [[a, 'owner'], [b, 'member']]) {
          await waitFor(async () => {
            const t = await editorText(p);
            return t.includes(fromA) && t.includes(fromB);
          }, `both lines on the ${who}'s screen`, 30000);
        }
        for (const p of [a, b]) {
          const t = await editorText(p);
          eq([count(t, fromA), count(t, fromB), count(t, 'base line')], [1, 1, 1], 'each line exactly once');
        }
      });

    await check('after both reload, the merged page is the same and nothing is doubled',
      'What the screen shows is not what is saved until a reload says so.',
      async () => {
        await a.waitForTimeout(3000);
        for (const p of [a, b]) {
          await p.reload();
          await waitFor(async () => (await editorText(p)).includes(fromB), 'the page after a reload', 20000);
          await p.waitForTimeout(1500);
          const t = await editorText(p);
          eq([count(t, fromA), count(t, fromB), count(t, 'base line')], [1, 1, 1], 'each line exactly once after a reload');
        }
      });

    await check('a cell changed offline and another cell of the same row changed online both survive',
      'A row keeps all its cells in one record. Replaying the offline copy of that record must not undo the change made online meanwhile.',
      async () => {
        await amountCell(a).waitFor({ timeout: 15000 });
        await a.context().setOffline(true);
        await a.waitForTimeout(500);
        await amountCell(a).fill('450');
        await a.keyboard.press('Tab');
        await nameCell(b).fill('Ferry to Busan');
        await b.keyboard.press('Tab');
        await b.waitForTimeout(2500);
        await a.context().setOffline(false);
        const table = (await api.list('tables', auth.token))[0];
        const amount = table.columns.find((c) => c.type === 'number');
        const name = table.columns[0];
        await waitFor(async () => {
          const [row] = await api.list('table_rows', auth.token, `&filter=${encodeURIComponent(`table="${table.id}"`)}&sort=position`);
          return row?.cells?.[amount.id] === 450;
        }, 'the offline amount on the server', 30000);
        await a.waitForTimeout(3000);
        const [row] = await api.list('table_rows', auth.token, `&filter=${encodeURIComponent(`table="${table.id}"`)}&sort=position`);
        eq(row.cells[name.id], 'Ferry to Busan', 'the name changed online is still there');
        eq(row.cells[amount.id], 450, 'next to the amount changed offline');
      });

    await check('two people changing different cells of one row at the same moment both keep their change, on both screens',
      'A row keeps all its cells in one record. Each person saved the whole row as they last saw it, so the later save put back the old value of the other person\'s cell.',
      async () => {
        await Promise.all([nameCell(a).fill('Ferry, both at once'), amountCell(b).fill('777')]);
        await Promise.all([a.keyboard.press('Tab'), b.keyboard.press('Tab')]);
        const table = (await api.list('tables', auth.token))[0];
        const amount = table.columns.find((c) => c.type === 'number');
        const name = table.columns[0];
        await waitFor(async () => {
          const [row] = await api.list('table_rows', auth.token, `&filter=${encodeURIComponent(`table="${table.id}"`)}&sort=position`);
          return row?.cells?.[name.id] === 'Ferry, both at once' && row?.cells?.[amount.id] === 777;
        }, 'both cells on the server', 15000);
        for (const [p, who] of [[a, 'owner'], [b, 'member']]) {
          await waitFor(async () => (await nameCell(p).inputValue()) === 'Ferry, both at once' && (await amountCell(p).inputValue()) === '777', `both cells on the ${who}'s screen`, 15000);
        }
      });

    await check('page text typed offline survives closing the tab before the connection comes back',
      'The offline notice promises page text is kept on this device. Closing the tab while offline is exactly when that promise matters.',
      async () => {
        const kept = 'typed offline then the tab was closed';
        await a.context().setOffline(true);
        await a.waitForTimeout(500);
        await typeAtEnd(a, kept);
        await a.waitForTimeout(1500);
        const ctx = a.context();
        await a.close();
        await ctx.setOffline(false);
        const again = await ctx.newPage();
        await again.goto(app.pb.url + '/');
        await again.getByTitle('Sign out').waitFor({ timeout: 20000 });
        await sidebar(again).getByText('Plan', { exact: true }).first().click();
        await waitFor(async () => (await editorText(again)).includes(kept), 'the kept text in a new tab', 20000);
        await waitFor(async () => (await editorText(b)).includes(kept), 'and on the other screen', 20000);
        eq(count(await editorText(b), kept), 1, 'once');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused replay is an offline edit that silently never arrived.',
      async () => eq(app.problems.filter((p) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(p)), [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
