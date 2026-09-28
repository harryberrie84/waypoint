import { readInviteFromSearch } from './workspace';

const KEY = 'waypoint:invite-token';

export function newInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function rememberInviteToken(search: string = typeof location === 'undefined' ? '' : location.search): void {
  const token = readInviteFromSearch(search)?.token;
  if (!token) return;
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    return;
  }
}

export function pendingInviteToken(): string {
  rememberInviteToken();
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return readInviteFromSearch(typeof location === 'undefined' ? '' : location.search)?.token ?? '';
  }
}

export function forgetInviteToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    return;
  }
}
