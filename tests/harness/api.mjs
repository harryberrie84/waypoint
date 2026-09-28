export function client(base) {
  const call = async (method, path, body, token, { form } = {}) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const headers = token ? { Authorization: token } : {};
        let payload;
        if (form) payload = form;
        else if (body !== undefined) {
          headers['content-type'] = 'application/json';
          payload = JSON.stringify(body);
        }
        const res = await fetch(base + path, { method, headers, body: payload });
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
        return { status: res.status, data, text };
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  };
  const rec = (c) => `/api/collections/${c}/records`;
  let n = 0;
  const api = {
    call,
    list: async (c, token, query = '') => {
      const out = [];
      for (let page = 1; ; page++) {
        const r = await call('GET', `${rec(c)}?page=${page}&perPage=500&skipTotal=1${query}`, undefined, token);
        if (r.status !== 200) throw new Error(`list ${c}: ${r.status} ${r.text}`);
        out.push(...r.data.items);
        if (r.data.items.length < 500) return out;
      }
    },
    create: (c, body, token) => call('POST', rec(c), body, token),
    update: (c, id, body, token) => call('PATCH', `${rec(c)}/${id}`, body, token),
    remove: (c, id, token) => call('DELETE', `${rec(c)}/${id}`, undefined, token),
    get: (c, id, token, query = '') => call('GET', `${rec(c)}/${id}${query}`, undefined, token),
    must: async (promise, what) => {
      const r = await promise;
      if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 300)}`);
      return r.data;
    },
    signup: async (name) => {
      const email = `${name}-${Date.now().toString(36)}${(n++).toString(36)}@example.org`.toLowerCase();
      const password = 'Passw0rd!2345';
      const r = await call('POST', rec('users'), { email, password, passwordConfirm: password, name });
      if (r.status !== 200) throw new Error(`signup ${name}: ${r.status} ${r.text}`);
      const a = await call('POST', '/api/collections/users/auth-with-password', { identity: email, password });
      return { id: a.data.record.id, token: a.data.token, email, password, name };
    },
    workspace: async (owner, name = 'Crew') => {
      const ws = await api.must(api.create('workspaces', { name, owner: owner.id }, owner.token), 'create workspace');
      const member = await api.must(api.create('workspace_members', { workspace: ws.id, user: owner.id, userName: owner.name, role: 'admin' }, owner.token), 'seat owner');
      return { ...ws, ownerMember: member };
    },
    invite: async (owner, ws, user, role = 'editor') => {
      await api.must(api.create('workspace_invites', { workspace: ws.id, email: user.email, role, invitedBy: owner.id, status: 'pending' }, owner.token), 'invite');
      const seated = (await api.list('workspace_members', user.token, `&filter=${encodeURIComponent(`workspace="${ws.id}" && user="${user.id}"`)}`))[0];
      if (seated) return seated;
      return api.must(api.create('workspace_members', { workspace: ws.id, user: user.id, userName: user.name, role }, user.token), 'accept invite');
    },
  };
  return api;
}
