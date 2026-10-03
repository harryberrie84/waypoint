import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, readdirSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir, platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { startSmtpSink } from './smtp.mjs';

export const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
export const SOURCE = resolve(process.env.WAYPOINT_SOURCE || ROOT);
export const PB_VERSION = (readFileSync(join(ROOT, 'Dockerfile'), 'utf8').match(/ARG PB_VERSION=(\S+)/) || [])[1] || '0.22.21';
export const ADMIN = { email: 'admin@example.org', password: 'Adm1n-pass-2345' };

function binaryName() {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform()];
  const cpu = { x64: 'amd64', arm64: 'arm64' }[arch()];
  if (!os || !cpu) throw new Error(`no PocketBase build for ${platform()}/${arch()}`);
  return { zip: `pocketbase_${PB_VERSION}_${os}_${cpu}.zip`, exe: os === 'windows' ? 'pocketbase.exe' : 'pocketbase' };
}

export async function ensurePocketBase() {
  if (process.env.WAYPOINT_PB_BIN) return process.env.WAYPOINT_PB_BIN;
  const { zip, exe } = binaryName();
  const dir = join(ROOT, '.cache', 'pocketbase', PB_VERSION);
  const bin = join(dir, exe);
  if (existsSync(bin)) return bin;
  mkdirSync(dir, { recursive: true });
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${zip}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  const zipPath = join(dir, zip);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  const r = spawnSync('unzip', ['-o', '-q', zipPath, exe, '-d', dir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('unzip failed (is unzip installed?)');
  chmodSync(bin, 0o755);
  rmSync(zipPath);
  return bin;
}

export async function freePort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  return port;
}

function copyHooks(from, to, { cronRoutes, onlyHooks }) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    if (onlyHooks && !onlyHooks.includes(f)) continue;
    let src = readFileSync(join(from, f), 'utf8');
    if (cronRoutes) {
      src = src.replace(/cronAdd\("([\w-]+)",\s*"[^"]*",\s*\(\)\s*=>\s*\{/g, (_, name) => `routerAdd("POST", "/__test/cron/${name}", (c) => {`);
    }
    writeFileSync(join(to, f), src);
  }
}

export async function startPocketBase({ publicDir, cronRoutes = true, onlyHooks, dir: reuseDir, port: fixedPort, mail = true, openRegistration = true } = {}) {
  const bin = await ensurePocketBase();
  const dir = reuseDir || mkdtempSync(join(tmpdir(), 'waypoint-test-'));
  if (!reuseDir) {
    cpSync(join(SOURCE, 'server', 'pb_migrations'), join(dir, 'migrations'), { recursive: true });
    copyHooks(join(SOURCE, 'server', 'pb_hooks'), join(dir, 'hooks'), { cronRoutes, onlyHooks });
  }
  const port = fixedPort || (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const args = ['serve', `--http=127.0.0.1:${port}`, `--dir=${join(dir, 'data')}`, `--migrationsDir=${join(dir, 'migrations')}`, `--hooksDir=${join(dir, 'hooks')}`];
  if (publicDir) args.push(`--publicDir=${publicDir}`);
  let log = '';
  // Tests sign up many throwaway accounts, so registration is open unless a test
  // asks for the invite-only install every real one starts as.
  const env = { ...process.env, WAYPOINT_OPEN_REGISTRATION: openRegistration ? 'true' : '' };
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  let exited = null;
  proc.on('exit', (code) => (exited = code));
  for (let i = 0; i < 100; i++) {
    if (exited !== null) throw new Error(`PocketBase exited with ${exited} at start:\n${log}`);
    try {
      const r = await fetch(url + '/api/health');
      if (r.ok) break;
    } catch {
      await new Promise((res) => setTimeout(res, 100));
    }
  }
  if (!reuseDir) {
    const r = spawnSync(bin, ['admin', 'create', ADMIN.email, ADMIN.password, `--dir=${join(dir, 'data')}`], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('admin create failed: ' + r.stdout + r.stderr);
  }
  const admin = await (await fetch(url + '/api/admins/auth-with-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: ADMIN.email, password: ADMIN.password }),
  })).json();
  // mail: false is an install nobody has set SMTP up on, which is every fresh one.
  const smtp = mail ? await startSmtpSink() : null;
  await fetch(url + '/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: admin.token },
    body: JSON.stringify({
      meta: { appName: 'Waypoint', appUrl: url, senderName: 'Waypoint', senderAddress: 'waypoint@example.org' },
      smtp: smtp
        ? { enabled: true, host: '127.0.0.1', port: smtp.port, tls: false, authMethod: 'PLAIN', username: '', password: '' }
        : { enabled: false },
    }),
  });
  const stop = async ({ keep = false } = {}) => {
    if (exited === null) {
      proc.kill('SIGTERM');
      await new Promise((r) => (exited !== null ? r() : proc.on('exit', r)));
    }
    await smtp?.stop();
    if (!keep) rmSync(dir, { recursive: true, force: true });
  };
  const self = { url, dir, port, adminToken: admin.token, smtp, stop, log: () => log };
  self.restart = async () => {
    await stop({ keep: true });
    const again = await startPocketBase({ publicDir, cronRoutes, onlyHooks, dir, port, mail, openRegistration });
    Object.assign(self, again, { restart: self.restart });
    return self;
  };
  return self;
}
