import { create } from 'zustand';
import { pb } from '../lib/pocketbase';
import { useVault } from './useVault';
import { LANDING_EVENT } from '../lib/landing';
import type { AuthUser } from '../types';

// ---------------------------------------------------------------------------
// Auth store
// ---------------------------------------------------------------------------
// Wraps PocketBase's authStore in a reactive Zustand store. PB persists the
// auth token in localStorage automatically, so a refresh keeps the session.
// We subscribe to authStore changes to stay in sync if the token is cleared
// (e.g. expiry) in another tab.

interface AuthState {
  user: AuthUser | null;
  ready: boolean; // initial session check complete
  error: string | null;
  busy: boolean;

  init: () => void;
  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string) => Promise<boolean>;
  // Email a reset link (needs SMTP and the email template pointed at the app).
  // Returns true once the request is accepted.
  requestPasswordReset: (email: string) => Promise<boolean>;
  // Finish a reset: the token rides in the email link (`/?reset=<token>`).
  confirmPasswordReset: (token: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}

function currentUser(): AuthUser | null {
  const rec = pb.authStore.record;
  if (!rec || !pb.authStore.isValid) return null;
  return {
    id: rec.id,
    email: (rec.email as string) ?? '',
    name: (rec.name as string) || (rec.email as string) || 'User',
  };
}

function messageFromError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; data?: { message?: string; data?: Record<string, { message?: string }> } };
    // PB validation errors nest field messages under data.data.<field>.message
    const fieldErrors = e.data?.data;
    if (fieldErrors) {
      const first = Object.values(fieldErrors).find((f) => f?.message);
      if (first?.message) return first.message;
    }
    if (e.data?.message) return e.data.message;
    if (e.message) return e.message;
  }
  return fallback;
}

export const useAuth = create<AuthState>((set) => ({
  user: currentUser(),
  ready: false,
  error: null,
  busy: false,

  init: () => {
    // Reflect any external token changes into the store.
    pb.authStore.onChange(() => {
      set({ user: currentUser() });
    });
    const user = currentUser();
    set({ user, ready: true });
    // Session restored without a password, try the on-device key cache.
    if (user) {
      void useVault.getState().load(user.id);
      // Pull the latest account record so per-user prefs (workspace home pages)
      // sync onto whichever device you open; nudge the UI to re-read when it lands.
      // Offline / expired just keeps the cached record.
      void pb
        .collection('users')
        .authRefresh()
        .then(() => {
          try {
            window.dispatchEvent(new CustomEvent(LANDING_EVENT));
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          /* keep the cached session */
        });
    }
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    try {
      await pb.collection('users').authWithPassword(email.trim(), password);
      const user = currentUser();
      set({ user, busy: false });
      // We have the password here, so unlock the vault transparently.
      if (user) void useVault.getState().tryUnlock(user.id, password);
      return true;
    } catch (err) {
      set({ busy: false, error: messageFromError(err, 'Could not sign in. Check your email and password.') });
      return false;
    }
  },

  register: async (name, email, password) => {
    set({ busy: true, error: null });
    // Lowercase the stored email so it matches the (lowercased) invite address,
    // the workspace_members create rule compares them exactly.
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    try {
      await pb.collection('users').create({
        email: cleanEmail,
        password,
        passwordConfirm: password,
        name: cleanName || cleanEmail.split('@')[0],
      });
      // Immediately authenticate the freshly-created account.
      await pb.collection('users').authWithPassword(cleanEmail, password);
      set({ user: currentUser(), busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: messageFromError(err, 'Could not create the account.') });
      return false;
    }
  },

  requestPasswordReset: async (email) => {
    set({ busy: true, error: null });
    try {
      await pb.collection('users').requestPasswordReset(email.trim().toLowerCase());
      set({ busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: messageFromError(err, 'Could not send a reset email.') });
      return false;
    }
  },

  confirmPasswordReset: async (token, password) => {
    set({ busy: true, error: null });
    try {
      await pb.collection('users').confirmPasswordReset(token, password, password);
      set({ busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: messageFromError(err, 'That reset link is invalid or has expired.') });
      return false;
    }
  },

  logout: () => {
    // Wipe the in-memory key + on-device cache before dropping the session.
    useVault.getState().lock();
    pb.authStore.clear();
    set({ user: null });
  },

  clearError: () => set({ error: null }),
}));
