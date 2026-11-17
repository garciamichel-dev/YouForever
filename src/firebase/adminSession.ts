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

export async function attachAdminAuthHeaders(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<RequestInit | undefined> {
  if (typeof window === 'undefined') return init;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const user = auth.currentUser;
  if (!user || !isSameOriginApiRequest(url)) return init;
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  if (!headers.has('Authorization')) {
    try {
      headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
    } catch {
      // No token available (offline / expired session): the request goes without it.
    }
  }
  return { ...init, headers };
}

export function installAdminAuthFetch(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;

  // Prevent "JSON.parse: unexpected character at line 1 column 1 of the JSON data"
  // when a reverse proxy returns an HTML 502/503/504 page or empty body on res.json().
  if (
    typeof Response !== 'undefined' &&
    Response.prototype &&
    typeof Response.prototype.json === 'function'
  ) {
    try {
      Object.defineProperty(Response.prototype, 'json', {
        configurable: true,
        writable: true,
        value: async function safeResponseJson(this: Response) {
          const text = await this.text();
          const trimmed = text ? text.trim() : '';
          if (!trimmed) {
            return {
              success: this.ok,
              ok: this.ok,
              error: this.ok
                ? undefined
                : 'El servidor no devolvió respuesta. Por favor intenta nuevamente en unos segundos.',
            };
          }
          try {
            return JSON.parse(trimmed);
          } catch {
            return {
              success: false,
              ok: false,
              error:
                this.status === 502 || this.status === 503 || this.status === 504
                  ? 'El servidor tardó en responder o se está actualizando. Por favor intenta nuevamente en unos segundos.'
                  : 'No pudimos procesar la respuesta del servidor en este momento. Por favor intenta nuevamente.',
            };
          }
        },
      });
    } catch {
      // Ignore if Response.prototype.json is not configurable
    }
  }

  const originalFetch = window.fetch.bind(window);
  const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isApi = isSameOriginApiRequest(url);
    const nextInit = await attachAdminAuthHeaders(input, init);
    const res = await originalFetch(input, nextInit);
    if (isApi && (res.status === 502 || res.status === 503)) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const retryInit = await attachAdminAuthHeaders(input, init);
      return originalFetch(input, retryInit);
    }
    return res;
  };

  try {
    Object.defineProperty(window, 'fetch', {
      value: wrappedFetch,
      configurable: true,
      writable: true,
    });
    return;
  } catch {
    // Fallback if window.fetch is not configurable directly on window
  }

  try {
    if (typeof Window !== 'undefined' && Window.prototype) {
      Object.defineProperty(Window.prototype, 'fetch', {
        value: wrappedFetch,
        configurable: true,
        writable: true,
      });
    }
  } catch {
    // Ignore if environment forbids redefining fetch; attachAdminAuthHeaders is used by API helpers.
  }
}

/** Exchanges the signed-in user's ID token for the HttpOnly admin session cookie. */
export async function establishAdminSession(): Promise<boolean> {
  try {
    const init = await attachAdminAuthHeaders('/api/auth/admin-session', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const res = await fetch('/api/auth/admin-session', init);
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearAdminSession(): Promise<void> {
  try {
    const init = await attachAdminAuthHeaders('/api/auth/admin-session', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    await fetch('/api/auth/admin-session', init);
  } catch {
    // ignore
  }
}
