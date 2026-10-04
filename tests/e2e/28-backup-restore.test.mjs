import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, registerInUi, pickStarter, sidebar, waitFor } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

const MARK = 'Ferry leaves at nine from pier two';

// Everything that matters about a workspace, with ids left out: copies get fresh
// ids, so equal shapes mean the copy holds the same data.
const textOf = (node) => (node?.text ?? '') + (Array.isArray(node?.content) ? node.content.map(textOf).join(' ') : '');
const pageShape = (p) => `${p.title}|${textOf(p.content).replace(/\s+/g, ' ').trim()}`;
const rowShape = (r) => JSON.stringify(Object.values(r.cells ?? {}).map((v) => JSON.stringify(v)).sort());

export default async function () {
  suite('browser: back up a workspace and restore it');
  const app = await startApp();
  const api = client(app.pb.url);
  try {
    const page = await app.newPage('owner');
    const me = await registerInUi(page, app.pb.url, 'owner');
    await pickStarter(page, 'a trip');
    await page.locator('.ProseMirror[contenteditable="true"]').first().waitFor({ timeout: 20000 });
    await page.locator('.ProseMirror > p').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.type(MARK + ' ');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/table');
    await page.locator('div[style*="z-index: 1300"] button', { hasText: 'Relational database' }).click();
    await page.getByText('New row').first().waitFor();
    const cell = (r) => page.locator('table tbody tr').nth(r).locator('input').first();
    await cell(0).fill('Ferry');
    await page.locator('table tbody tr').first().locator('input[inputmode=decimal]').fill('450');
    await page.getByText('New row').first().click();
    await waitFor(async () => (await page.locator('table tbody tr').count()) === 2, 'a second row');
    await cell(1).fill('Hostel');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(3000);

    const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: me.email, password: me.password }), 'token');
    const snapshot = async () => {
      const pages = await api.list('pages', auth.token);
      const tables = await api.list('tables', auth.token);
      const rows = await api.list('table_rows', auth.token);
      return { pages, tables, rows };
    };
    const before = await snapshot();
    ok(before.pages.some((p) => textOf(p.content).includes(MARK)), 'the marker text reached the server');
    ok(before.tables.length > 0 && before.rows.length > 0, 'the trip starter has tables with rows');

    let zipPath = '';
    await check('a backup downloads as a zip',
      'A backup that cannot be made is no backup.',
      async () => {
        await page.getByRole('button', { name: /Settings/ }).first().click();
        await page.getByRole('button', { name: 'Workspace', exact: true }).first().click();
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30000 }),
          page.getByRole('button', { name: /download a backup/ }).click(),
        ]);
        zipPath = join(tmpdir(), `waypoint-backup-${Date.now()}.zip`);
        await download.saveAs(zipPath);
        const bytes = readFileSync(zipPath);
        ok(bytes.length > 200 && bytes[0] === 0x50 && bytes[1] === 0x4b, 'the file is a zip');
      });

    let after;
    await check('restoring it brings back every page, its text, every table and every row, as copies',
      'Restore was never run end to end. A backup is only as good as the restore that reads it.',
      async () => {
        await page.getByLabel('restore a backup').setInputFiles(zipPath);
        await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();
        await page.getByText(/^Restored \d+ page/).first().waitFor({ timeout: 60000 });
        await page.waitForTimeout(4000);
        after = await snapshot();
        eq(after.pages.length, before.pages.length * 2, 'pages after the restore');
        eq(after.tables.length, before.tables.length * 2, 'tables after the restore');
        eq(after.rows.length, before.rows.length * 2, 'rows after the restore');
        const beforeIds = new Set(before.pages.map((p) => p.id));
        const copies = after.pages.filter((p) => !beforeIds.has(p.id));
        eq(copies.map(pageShape).sort(), before.pages.map(pageShape).sort(), 'each copy has the title and text of its original');
        const rowIds = new Set(before.rows.map((r) => r.id));
        eq(after.rows.filter((r) => !rowIds.has(r.id)).map(rowShape).sort(), before.rows.map(rowShape).sort(), 'each restored row holds the values of its original');
        const kids = (list) => list.filter((p) => p.parent).length;
        eq(kids(copies), kids(before.pages), 'sub-pages are still under a parent');
      });

    await check('restoring changed nothing that was already there',
      'Restore promises to add copies only. Touching an original is the one thing it must never do.',
      async () => {
        const now = new Map(after.pages.map((p) => [p.id, p]));
        for (const p of before.pages) eq(pageShape(now.get(p.id) ?? {}), pageShape(p), `the original page "${p.title}"`);
        const rows = new Map(after.rows.map((r) => [r.id, r]));
        for (const r of before.rows) eq(rowShape(rows.get(r.id) ?? {}), rowShape(r), 'an original row');
      });

    await check('the restored copy of the page opens with its text',
      'The server holding the text is half of it; the copy has to open in the editor too.',
      async () => {
        const original = before.pages.find((p) => textOf(p.content).includes(MARK));
        const copy = after.pages.find((p) => p.id !== original.id && textOf(p.content).includes(MARK));
        ok(copy, 'a copy of the marked page');
        // Rename the original so the copy is the only page with this title, and
        // opening it by name can only open the copy.
        await api.must(api.update('pages', original.id, { title: 'The original' }, auth.token), 'rename the original');
        await page.goto(app.pb.url + '/');
        await page.getByTitle('Sign out').waitFor({ timeout: 20000 });
        await waitFor(async () => (await sidebar(page).getByText('The original', { exact: true }).count()) === 1, 'the renamed original in the sidebar');
        await sidebar(page).getByText(copy.title, { exact: true }).first().click();
        await waitFor(async () => (await page.locator('main input').first().inputValue()) === copy.title, 'the copy open');
        await waitFor(async () => (await page.locator('.ProseMirror').first().innerText()).includes(MARK), 'the text in the opened copy', 20000);
      });

    await check('undo right after a restore removes exactly the copies',
      'Undo must take away what the restore added and nothing else.',
      async () => {
        await page.getByRole('button', { name: /Settings/ }).first().click();
        await page.getByRole('button', { name: 'Workspace', exact: true }).first().click();
        await page.getByLabel('restore a backup').setInputFiles(zipPath);
        await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();
        await page.getByText(/^Restored \d+ page/).first().waitFor({ timeout: 60000 });
        await page.waitForTimeout(3000);
        const mid = await snapshot();
        eq(mid.pages.length, before.pages.length * 3, 'a second restore added another set');
        await page.getByRole('button', { name: /Undo/ }).first().click();
        await page.waitForTimeout(4000);
        const end = await snapshot();
        eq(end.pages.map((p) => p.id).sort(), after.pages.map((p) => p.id).sort(), 'pages back to before the second restore');
        eq(end.rows.map((r) => r.id).sort(), after.rows.map((r) => r.id).sort(), 'rows back to before the second restore');
        eq(end.tables.map((t) => t.id).sort(), after.tables.map((t) => t.id).sort(), 'tables back to before the second restore');
      });

    await check('nothing along the way was refused by the server or crashed',
      'A refused write in a restore is a page or row that silently did not come back.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
