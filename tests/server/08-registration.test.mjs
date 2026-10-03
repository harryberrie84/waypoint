import { startPocketBase } from '../harness/pocketbase.mjs';
import { client } from '../harness/api.mjs';
import { suite, check, eq, ok } from '../harness/runner.mjs';

export default async function () {
  suite('registration: an invite-only install lets in its owner and invited people, nobody else');
  const pb = await startPocketBase({ openRegistration: false });
  const api = client(pb.url);
  const password = 'Passw0rd!2345';
  const register = (email) => api.call('POST', '/api/collections/users/records', { email, password, passwordConfirm: password, name: email.split('@')[0] });
  const config = async () => (await api.call('GET', '/api/waypoint/config')).data?.openRegistration;
  try {
    await check('a brand-new install offers sign-up, so its owner can make the first account',
      'With nothing configured, the person who just installed it must still be able to get in.',
      async () => {
        eq(await config(), true, 'sign-up offered on an empty install');
      });

    const owner = await api.signup('owner');

    await check('once the owner exists, a stranger cannot sign up and the form says so',
      'An instance on a public address must not carry a public sign-up form.',
      async () => {
        eq(await config(), false, 'sign-up offered after the first account');
        const r = await register('stranger@example.org');
        ok(r.status >= 400 && r.status < 500, `a stranger signed up: ${r.status} ${r.text.slice(0, 200)}`);
      });

    await check('someone with a pending invite can sign up with that address',
      'The invite is the way in; refusing the invited person would lock everyone out but the owner.',
      async () => {
        const ws = await api.workspace(owner);
        await api.must(api.create('workspace_invites', { workspace: ws.id, email: 'guest@example.org', role: 'editor', invitedBy: owner.id, status: 'pending', token: api.inviteToken() }, owner.token), 'invite');
        const r = await register('guest@example.org');
        eq(r.status, 200, `the invited address was refused: ${r.text.slice(0, 200)}`);
        const other = await register('guest2@example.org');
        ok(other.status >= 400 && other.status < 500, 'an address that was not invited got in alongside it');
      });
  } finally {
    await pb.stop();
  }
}
