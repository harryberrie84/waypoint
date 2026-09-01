import { useState } from 'react';
import { Lock, Unlock, ShieldCheck, X, KeyRound, Copy, Check } from 'lucide-react';
import { useVault } from '../store/useVault';
import { useAuth } from '../store/useAuth';
import { toast } from '../store/useToast';

// VaultPanel, set up / unlock / recover the private encryption key. Opened from
// the page lock controls (useVault.openPanel) and shown once with the recovery
// code right after setup. Copy stays plain and a little blunt about the stakes:
// a forgotten password with no recovery code means the content is unrecoverable.

export function VaultPanel() {
  const open = useVault((s) => s.panelOpen);
  const close = useVault((s) => s.closePanel);
  const status = useVault((s) => s.status);
  const recoveryCode = useVault((s) => s.recoveryCode);
  const setup = useVault((s) => s.setup);
  const unlock = useVault((s) => s.unlock);
  const unlockWithRecovery = useVault((s) => s.unlockWithRecovery);
  const lock = useVault((s) => s.lock);
  const clearRecoveryCode = useVault((s) => s.clearRecoveryCode);
  const userId = useAuth((s) => s.user?.id ?? null);

  const rewrapToPassword = useVault((s) => s.rewrapToPassword);

  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  // Set after a recovery-code unlock: the password door is known-stale, so offer
  // to point it at the password they use now instead of leaving them on the code
  // forever. Holds the code because re-wrapping needs a door it can open.
  const [stale, setStale] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  if (!open) return null;

  const done = () => {
    setPassword('');
    setCode('');
    setNewPassword('');
    setStale(null);
    setUseRecovery(false);
    setErr('');
    close();
  };

  const doSetup = async () => {
    if (!userId || password.length < 8) {
      setErr('enter your account password (at least 8 characters).');
      return;
    }
    setBusy(true);
    setErr('');
    const result = await setup(userId, password);
    setBusy(false);
    setPassword('');
    if (!result) setErr('could not set up the vault. is the user_keys collection applied?');
  };

  const doUnlock = async () => {
    setBusy(true);
    setErr('');
    const okUnlock = useRecovery ? await unlockWithRecovery(code) : await unlock(password);
    setBusy(false);
    if (!okUnlock) {
      setErr(useRecovery ? 'that recovery code did not match.' : 'wrong password.');
      return;
    }
    // Getting in with the code means the password door did not open, which is
    // what a password change leaves behind. Offer to fix it while we still hold
    // a working code, rather than leaving them on the code from now on.
    if (useRecovery) {
      setStale(code);
      setErr('');
      return;
    }
    done();
  };

  const doRewrap = async () => {
    if (!stale) return;
    setBusy(true);
    setErr('');
    const result = await rewrapToPassword({ recoveryCode: stale }, newPassword);
    setBusy(false);
    if (result === 'ok') {
      toast('your password opens the vault again');
      done();
      return;
    }
    if (result === 'too-short') setErr('use at least 8 characters, the same password you sign in with.');
    else if (result === 'wrong-secret') setErr('that recovery code stopped matching. unlock again.');
    else setErr('could not update it. nothing was changed, you can still use the code.');
  };

  const copyCode = () => {
    if (!recoveryCode) return;
    void navigator.clipboard?.writeText(recoveryCode).then(
      () => {
        setCopied(true);
        toast('recovery code copied');
      },
      () => {},
    );
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-coal/40 p-4 backdrop-blur-sm" onMouseDown={done}>
      <div
        className="w-full max-w-md rounded-2xl border border-paper-line bg-paper p-5 shadow-2xl dark:border-coal-line dark:bg-coal-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-clay" />
          <span className="flex-1 font-display text-lg font-semibold text-ink dark:text-coal-text">private vault</span>
          <button type="button" onClick={done} className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 1. Just set up, show the recovery code once. */}
        {recoveryCode ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft dark:text-coal-soft">
              your vault is ready. write down this recovery code and keep it somewhere safe, it's the only way back in
              if you forget your password. no one, including the server, can recover it for you.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-clay/40 bg-clay/10 px-3 py-3">
              <KeyRound className="h-4 w-4 shrink-0 text-clay" />
              <code className="flex-1 select-all break-all font-mono text-sm text-ink dark:text-coal-text">{recoveryCode}</code>
              <button type="button" onClick={copyCode} className="shrink-0 rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line" title="Copy">
                {copied ? <Check className="h-4 w-4 text-clay" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                clearRecoveryCode();
                done();
              }}
              className="w-full rounded-lg bg-clay py-2.5 text-sm font-semibold text-white hover:bg-clay-soft"
            >
              i've written it down
            </button>
          </div>
        ) : stale ? (
          /* 1b. In via the recovery code, so the password door is stale. Point it
             at the password they sign in with now. Skipping is safe: the code
             still works, it is just the only thing that does. */
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <Unlock className="h-4 w-4" /> unlocked with your recovery code.
            </div>
            <p className="text-sm text-ink-soft dark:text-coal-soft">
              your password did not open the vault, which is what happens after you change it. set it now and your
              password works again. your recovery code does not change.
            </p>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doRewrap()}
              placeholder="the password you sign in with"
              autoComplete="current-password"
              className="auth-input"
            />
            {err && <p className="text-xs text-red-500">{err}</p>}
            <button type="button" onClick={() => void doRewrap()} disabled={busy} className="w-full rounded-lg bg-clay py-2.5 text-sm font-semibold text-white hover:bg-clay-soft disabled:opacity-50">
              {busy ? 'updating…' : 'use this password'}
            </button>
            <button type="button" onClick={done} className="block w-full text-center text-xs font-medium text-ink-faint hover:underline dark:text-coal-soft">
              not now, keep using the code
            </button>
          </div>
        ) : status === 'absent' ? (
          /* 2. No vault yet, set one up. */
          <div className="space-y-3">
            <p className="text-sm text-ink-soft dark:text-coal-soft">
              set up a private vault to lock pages so only you can read them. content is encrypted on your device with a
              key derived from your password, the server only ever stores the encrypted form.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doSetup()}
              placeholder="your account password"
              autoComplete="current-password"
              className="auth-input"
            />
            {err && <p className="text-xs text-red-500">{err}</p>}
            <button type="button" onClick={() => void doSetup()} disabled={busy} className="w-full rounded-lg bg-clay py-2.5 text-sm font-semibold text-white hover:bg-clay-soft disabled:opacity-50">
              {busy ? 'setting up…' : 'set up vault'}
            </button>
          </div>
        ) : status === 'unlocked' ? (
          /* 3. Unlocked. */
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <Unlock className="h-4 w-4" /> your vault is unlocked on this device.
            </div>
            <button
              type="button"
              onClick={() => {
                lock();
                done();
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-paper-line py-2.5 text-sm font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
            >
              <Lock className="h-4 w-4" /> lock the vault
            </button>
          </div>
        ) : (
          /* 4. Locked, unlock by password, or fall back to the recovery code. */
          <div className="space-y-3">
            <p className="text-sm text-ink-soft dark:text-coal-soft">
              {useRecovery ? 'enter your recovery code to unlock.' : 'enter your password to unlock your private pages.'}
            </p>
            {useRecovery ? (
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void doUnlock()}
                placeholder="XXXX-XXXX-XXXX-…"
                className="auth-input font-mono"
              />
            ) : (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void doUnlock()}
                placeholder="your account password"
                autoComplete="current-password"
                className="auth-input"
              />
            )}
            {err && <p className="text-xs text-red-500">{err}</p>}
            <button type="button" onClick={() => void doUnlock()} disabled={busy} className="w-full rounded-lg bg-clay py-2.5 text-sm font-semibold text-white hover:bg-clay-soft disabled:opacity-50">
              {busy ? 'unlocking…' : 'unlock'}
            </button>
            <button
              type="button"
              onClick={() => {
                setUseRecovery((v) => !v);
                setErr('');
              }}
              className="block w-full text-center text-xs font-medium text-clay hover:underline"
            >
              {useRecovery ? 'use my password instead' : 'use a recovery code'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
