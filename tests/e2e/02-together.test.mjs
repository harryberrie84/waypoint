import { startApp, registerInUi, pickStarter, sidebar, sidebarText, waitFor, editorText } from '../harness/browser.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq } from '../harness/runner.mjs';

const SETUPS = [
  { label: 'every hook, as the Docker image runs', options: {} },
  { label: 'only the invite hooks, as live runs', options: { onlyHooks: ['invite_email.pb.js', 'invite_claim.pb.js'] } },
];

export default async function () {
  for (const setup of SETUPS) await run(setup);
}

async function run({ label, options }) {
  suite(`browser: two people in one workspace (${label})`);
  const app = await startApp(options);
  const url = app.pb.url;
  const api = client(url);
  try {
    const a = await app.newPage('owner');
    const b = await app.newPage('member');
    const owner = await registerInUi(a, url, 'owner');
    await pickStarter(a, 'a trip');
    const auth = await api.must(api.call('POST', '/api/collections/users/auth-with-password', { identity: owner.email, password: owner.password }), 'owner token');
    const ws = (await api.list('workspaces', auth.token))[0];
    const memberEmail = `member-${Date.now()}@example.org`;

    await check('an invited person who opens the invite link and signs up lands in the workspace with its pages',
      'Joining is how a crew forms. The link carries the invite’s one-time secret, which is what lets a brand-new, unverified account in.',
      async () => {
        const token = api.inviteToken();
        await api.must(api.create('workspace_invites', { workspace: ws.id, email: memberEmail, role: 'editor', invitedBy: auth.record.id, status: 'pending', token }, auth.token), 'invite');
        await registerInUi(b, url, 'member', memberEmail, `/?invite=${encodeURIComponent(memberEmail)}&ws=Trip&t=${encodeURIComponent(token)}`);
        await waitFor(async () => (await sidebarText(b)).includes('Trip'), "the owner's Trip page in the member's sidebar", 15000);
      });

    await check('signing up with an invited address but without the link does not join',
      'Anyone could otherwise register the invited address first and take the seat.',
      async () => {
        const c = await app.newPage('squatter');
        const squatEmail = `squat-${Date.now()}@example.org`;
        await api.must(api.create('workspace_invites', { workspace: ws.id, email: squatEmail, role: 'admin', invitedBy: auth.record.id, status: 'pending', token: api.inviteToken() }, auth.token), 'invite');
        await registerInUi(c, url, 'squatter', squatEmail);
        await c.waitForTimeout(3000);
        eq((await sidebarText(c)).includes('Trip'), false, "the owner's Trip page is in the squatter's sidebar");
      });

    await sidebar(a).getByText('Trip', { exact: true }).first().click();
    await sidebar(b).getByText('Trip', { exact: true }).first().click();
    await a.locator('.ProseMirror').first().waitFor();
    await b.locator('.ProseMirror').first().waitFor();
    await a.waitForTimeout(2000);

    await check("each person sees the other's typing on the same page without reloading",
      'Live co-editing is the point of a shared page; if the relay is refused or not delivered, two people overwrite each other.',
      async () => {
        const fromA = `from the owner ${Date.now()}`;
        await a.locator('.ProseMirror').first().click();
        await a.keyboard.press('Control+End');
        await a.keyboard.press('Enter');
        await a.keyboard.type(fromA);
        await waitFor(async () => (await editorText(b)).includes(fromA), "the owner's words on the member's screen", 15000);
        const fromB = `from the member ${Date.now()}`;
        await b.locator('.ProseMirror').first().click();
        await b.keyboard.press('Control+End');
        await b.keyboard.press('Enter');
        await b.keyboard.type(fromB);
        await waitFor(async () => (await editorText(a)).includes(fromB), "the member's words on the owner's screen", 15000);
      });

    await check("a rename by one person shows in the other's sidebar",
      'Titles are how people find pages; a stale title sends a colleague looking in the wrong place.',
      async () => {
        const title = a.locator('main input').first();
        await title.click();
        await title.fill('Trip to Gotland');
        await waitFor(async () => (await sidebarText(b)).includes('Trip to Gotland'), "the new title in the member's sidebar", 15000);
      });

    await check('nothing either person did was refused by the server',
      'A refused save is invisible in the UI and lost on reload.',
      async () => eq(app.problems, [], 'failed requests or page errors'));
  } finally {
    await app.stop();
  }
}
