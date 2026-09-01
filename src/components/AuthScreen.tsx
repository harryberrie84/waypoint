import { useMemo, useState } from 'react';
import { useAuth } from '../store/useAuth';
import { readInviteFromSearch } from '../lib/workspace';
import { MapPin } from 'lucide-react';

// AuthScreen, sign in / sign up / password reset. Open registration per the
// deployment brief: anyone reaching the app (LAN or tunnel) can self-register.

type Mode = 'login' | 'register' | 'forgot' | 'reset';

export function AuthScreen() {
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const requestPasswordReset = useAuth((s) => s.requestPasswordReset);
  const confirmPasswordReset = useAuth((s) => s.confirmPasswordReset);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);

  // Arriving from an invite email (`/?invite=…`): prefill the address and start
  // on "create account" so the invitee signs up with the exact email the invite
  // was sent to, that's what the server hook claims into a membership.
  const invite = useMemo(() => readInviteFromSearch(window.location.search), []);
  // A reset link (`/?reset=<token>`) drops straight into "set a new password".
  const resetToken = useMemo(() => new URLSearchParams(window.location.search).get('reset'), []);

  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : invite ? 'register' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(invite?.email ?? '');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false); // reset email requested
  const [resetDone, setResetDone] = useState(false); // password changed, back to login

  const go = (m: Mode) => {
    setMode(m);
    setSent(false);
    clearError();
  };

  const submit = async () => {
    if (mode === 'login') {
      await login(email.trim(), password);
    } else if (mode === 'register') {
      await register(name.trim(), email.trim(), password);
    } else if (mode === 'forgot') {
      if (await requestPasswordReset(email.trim())) setSent(true);
    } else if (mode === 'reset' && resetToken) {
      if (await confirmPasswordReset(resetToken, password)) {
        window.history.replaceState({}, '', window.location.pathname);
        setResetDone(true);
        setPassword('');
        setMode('login');
      }
    }
  };

  const title = mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Set a new password' : null;
  const buttonLabel = busy
    ? 'Working…'
    : mode === 'login'
      ? 'Sign in'
      : mode === 'register'
        ? 'Create account'
        : mode === 'forgot'
          ? 'Send reset link'
          : 'Set new password';

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 dark:bg-coal">
      <div className="w-full max-w-sm">
        <div className="relative mb-8 text-center">
          {/* a dotted shot arcing to its mark, a quiet Ochre (sniper) + waypoint nod */}
          <svg
            aria-hidden
            viewBox="0 0 140 44"
            className="pointer-events-none absolute left-1/2 top-0 h-11 w-36 -translate-x-1/2 -translate-y-4 text-ochre opacity-80 dark:text-ochre-soft"
          >
            <path d="M8 38 Q70 -8 126 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" />
            <circle cx="126" cy="20" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="126" cy="20" r="1.2" fill="currentColor" />
          </svg>
          <div className="relative mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-clay to-ochre text-white shadow-sm">
            <MapPin className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-semibold text-ink dark:text-coal-text">Waypoint</h1>
          <p className="mt-1 text-sm text-ink-faint dark:text-coal-soft">Shared trip planning for your crew.</p>
        </div>

        <div className="rounded-2xl border border-paper-line bg-paper p-6 shadow-sm dark:border-coal-line dark:bg-coal-panel">
          {invite && mode !== 'reset' && (
            <div className="mb-5 rounded-lg border border-clay/30 bg-clay/10 px-3 py-2.5 text-xs text-ink-soft dark:text-coal-text">
              you've been invited to {invite.workspace || 'a workspace'}. sign up or sign in with{' '}
              <span className="font-medium text-clay">{invite.email}</span> to join.
            </div>
          )}
          {resetDone && mode === 'login' && (
            <div className="mb-5 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              password updated. sign in with your new password.
            </div>
          )}

          {(mode === 'login' || mode === 'register') && (
            <div className="mb-5 flex rounded-lg bg-paper-panel p-1 dark:bg-coal">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => go(m)}
                  className={[
                    'flex-1 rounded-md py-1.5 text-sm font-medium transition-colors',
                    mode === m
                      ? 'bg-paper text-ink shadow-sm dark:bg-coal-panel dark:text-coal-text'
                      : 'text-ink-faint dark:text-coal-soft',
                  ].join(' ')}
                >
                  {m === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          )}

          {title && <h2 className="mb-1 text-sm font-semibold text-ink dark:text-coal-text">{title}</h2>}
          {mode === 'forgot' && !sent && (
            <p className="mb-4 text-xs text-ink-faint dark:text-coal-soft">
              enter your email and we'll send a link to set a new password.
            </p>
          )}
          {mode === 'reset' && (
            <p className="mb-4 text-xs text-ink-faint dark:text-coal-soft">choose a new password for your account.</p>
          )}

          {mode === 'forgot' && sent ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                if an account exists for that email, a reset link is on its way. check your inbox.
              </div>
              <button type="button" onClick={() => go('login')} className="text-xs font-medium text-clay hover:underline">
                back to sign in
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {mode === 'register' && (
                <Field label="Name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void submit()}
                    placeholder="Alex Rivera"
                    autoComplete="name"
                    className="auth-input"
                  />
                </Field>
              )}
              {mode !== 'reset' && (
                <Field label="Email">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void submit()}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="auth-input"
                  />
                </Field>
              )}
              {mode !== 'forgot' && (
                <Field label={mode === 'reset' ? 'New password' : 'Password'}>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submit();
                    }}
                    placeholder={mode === 'login' ? 'Your password' : 'At least 8 characters'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    className="auth-input"
                  />
                </Field>
              )}

              {mode === 'login' && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => go('forgot')} className="text-xs font-medium text-clay hover:underline">
                    Forgot password?
                  </button>
                </div>
              )}

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-300">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="w-full rounded-lg bg-clay py-2.5 text-sm font-semibold text-white transition-colors hover:bg-clay-soft disabled:opacity-50"
              >
                {buttonLabel}
              </button>

              {(mode === 'forgot' || mode === 'reset') && (
                <button type="button" onClick={() => go('login')} className="block w-full text-center text-xs font-medium text-clay hover:underline">
                  back to sign in
                </button>
              )}
            </div>
          )}
        </div>

        {(mode === 'login' || mode === 'register') && (
          <p className="mt-4 text-center text-xs text-ink-faint dark:text-coal-soft">
            {mode === 'login' ? 'New here? ' : 'Already have an account? '}
            <button
              type="button"
              onClick={() => go(mode === 'login' ? 'register' : 'login')}
              className="font-medium text-clay hover:underline"
            >
              {mode === 'login' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-soft dark:text-coal-soft">{label}</span>
      {children}
    </label>
  );
}
