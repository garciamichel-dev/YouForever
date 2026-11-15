/**
 * V5.3.1 — Browser side of the administrator authentication.
 *
 * The server no longer trusts e-mails sent by the browser. Every same-origin request to `/api/`
 * made while someone is signed in with Firebase Authentication carries
 * `Authorization: Bearer <Firebase ID token>`, which the server verifies cryptographically.
 * Existing screens keep calling `fetch` exactly as before (their `x-admin-user` headers and
 * `?admin=` parameters are now ignored by the server), so no functionality changes.
 *
 * Download links, iframes and new windows cannot send headers; for them the server issues an
 * HttpOnly session cookie in exchange for a verified token (`establishAdminSession`).
 */
import { auth } from './config.ts';

let installed = false;

function isSameOriginApiRequest(url: string): boolean {
  try {
    const resolved = new URL(url, window.location.href);
    return resolved.origin === window.location.origin && resolved.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export function installAdminAuthFetch(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const user = auth.currentUser;
    if (!user || !isSameOriginApiRequest(url)) return originalFetch(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has('Authorization')) {
      try {
        headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
      } catch {
        // No token available (offline / expired session): the request goes without it.
      }
    }
    return originalFetch(input, { ...init, headers });
  };
}

/** Exchanges the signed-in user's ID token for the HttpOnly admin session cookie. */
export async function establishAdminSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/admin-session', { method: 'POST', credentials: 'same-origin' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearAdminSession(): Promise<void> {
  try {
    await fetch('/api/auth/admin-session', { method: 'DELETE', credentials: 'same-origin' });
  } catch {
    // ignore
  }
}
